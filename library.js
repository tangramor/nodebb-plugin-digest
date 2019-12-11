'use strict';

var plugin = {};
var async = module.parent.require('async');
var topics = module.parent.require('./topics');
var posts = module.parent.require('./posts');
var categories = module.parent.require('./categories');
var meta = module.parent.require('./meta');
var privileges = module.parent.require('./privileges');
var rewards = module.parent.require('./rewards');
var user = module.parent.require('./user');
var helpers = module.parent.require('./controllers/helpers');
var db = module.parent.require('./database');
var SocketPlugins = module.parent.require('./socket.io/plugins');
var pagination = module.parent.require('./pagination');

plugin.init = function (params, callback) {
	var app = params.router;
	var middleware = params.middleware;

	app.get('/admin/plugins/digest', middleware.admin.buildHeader, renderAdmin);
	app.get('/api/admin/plugins/digest', renderAdmin);

	app.get('/digest', middleware.buildHeader, renderDigest);
	app.get('/api/digest', renderDigest);

	handleSocketIO();

	callback();
};

plugin.appendConfig = function (config, callback) {
	meta.settings.get('digest', function (err, settings) {
		if (err) {
			return callback(err);
		}

		config['digest'] = settings;
		callback(null, config);
	});
};

plugin.addNavigation = function (menu, callback) {
	menu = menu.concat(
		[
			{
				route: '/digest',
				title: 'Unsolved',
				iconClass: 'fa-diamond',
				text: 'Unsolved',
			},
			{
				route: '/solved',
				title: 'Solved',
				iconClass: 'fa-check-circle',
				text: 'Solved',
			},
		]
	);

	callback(null, menu);
};

plugin.addAdminNavigation = function (header, callback) {
	header.plugins.push({
		route: '/plugins/digest',
		icon: 'fa-diamond',
		name: 'Digest',
	});

	callback(null, header);
};

plugin.getTopics = function (data, callback) {
	var topics = data.topics;

	async.map(topics, function (topic, next) {
		if (parseInt(topic.isDigest, 10)) {
			topic.title = '<span class="digested"><i class="fa fa-diamond"></i> 精华</span> ' + topic.title;
		}

		return next(null, topic);
	}, function (err) {
		return callback(err, data);
	});
};

plugin.addThreadTool = function (data, callback) {
	var isDigest = parseInt(data.topic.isDigest, 10);

	if (isDigest) {
		data.tools = data.tools.concat([
			{
				class: 'toggleDigestStatus alert-warning',
				title: '标记为普通帖子',
				icon: 'fa-comments',
			},
		]);
	} else {
		data.tools.push({
			class: 'toggleDigestStatus alert-warning',
			title: '标记为精华',
			icon: 'fa-diamond',
		});
	}

	callback(false, data);
};

plugin.getConditions = function (conditions, callback) {
	conditions.push({
		name: 'Times questions accepted',
		condition: 'digest/marked',
	});

	callback(false, conditions);
};

function hasPerms(uid, cid, cb) {
	async.parallel({
		isAdminOrGlobalMod : async.apply(user.isAdminOrGlobalMod, uid),
		isModerator        : async.apply(user.isModerator, uid, cid)
	}, function(err, results) {
		cb(err, results ? (results.isAdminOrGlobalMod || results.isModerator) : false);
	});
}

function renderAdmin(req, res, next) {
	async.waterfall([
		async.apply(db.getSortedSetRange, 'categories:cid', 0, -1),
		function (cids, next) {
			categories.getCategoriesFields(cids, ['cid', 'name'], next);
		},
	], function (err, data) {
		if (err) {
			return next(err);
		}

		res.render('admin/plugins/digest', {
			categories: data,
		});
	});
}

function handleSocketIO() {
	SocketPlugins.Digest = {};

	SocketPlugins.Digest.toggleDigestStatus = function (socket, data, callback) {
		privileges.topics.canEdit(data.tid, socket.uid, function (err, canEdit) {
			if (err) {
				return callback(err);
			}

			if (!canEdit) {
				return callback(new Error('[[error:no-privileges]]'));
			}

			if (data.pid) {
				toggleDigestStatus(data.tid, data.pid, callback);
			} else {
				toggleDigestStatus(data.tid, callback);
			}
		});
	};
}

function toggleDigestStatus(tid, pid, callback) {
	if (!callback) {
		callback = pid;
		pid = false;
	}

	topics.getTopicField(tid, 'isDigest', function (err, isDigest) {
		if (err) {
			return callback(err);
		}

		isDigest = parseInt(isDigest, 10) === 1;

		async.parallel([
			function (next) {
				topics.setTopicField(tid, 'isDigest', isDigest ? 0 : 1, next);
			},
			function (next) {
				if (!isDigest) {
					async.parallel([
						function (next) {
							posts.getPostData(pid, function (err, data) {
								if (err) {
									return next(err);
								}

								if(data && data.uid) {
									rewards.checkConditionAndRewardUser(data.uid, 'digest/marked', function (callback) {
										user.incrementUserFieldBy(data.uid, 'digest/marked', 1, callback);
									});
								}

								next();
							});
						},
						function (next) {
							db.sortedSetAdd('topics:digest', Date.now(), tid, next);
						},
					], next);
				} else {
					db.sortedSetRemove('topics:digest', tid, function () {
						topics.deleteTopicField(tid, 'digestPid');
					});
				}
			},
		], function (err) {
			callback(err, { isDigest: !isDigest });
		});
	});
}

function renderDigest(req, res, next) {
	var page = parseInt(req.query.page, 10) || 1;
	var pageCount = 1;
	var stop = 0;
	var topicCount = 0;
	var settings;

	async.waterfall([
		function (next) {
			async.parallel({
				settings: function (next) {
					user.getSettings(req.uid, next);
				},
				tids: function (next) {
					db.getSortedSetRevRange('topics:digest', 0, 199, next);
				},
			}, next);
		},
		function (results, next) {
			settings = results.settings;
			privileges.topics.filterTids('read', results.tids, req.uid, next);
		},
		function (tids, next) {
			var start = Math.max(0, (page - 1) * settings.topicsPerPage);
			stop = start + settings.topicsPerPage - 1;

			topicCount = tids.length;
			pageCount = Math.max(1, Math.ceil(topicCount / settings.topicsPerPage));
			tids = tids.slice(start, stop + 1);

			topics.getTopicsByTids(tids, req.uid, next);
		},
	], function (err, topics) {
		if (err) {
			return next(err);
		}

		var data = {};
		data.topics = topics;
		data.nextStart = stop + 1;
		data.set = 'topics:digest';
		data['feeds:disableRSS'] = true;
		data.pagination = pagination.create(page, pageCount);
		if (req.path.startsWith('/api/digest') || req.path.startsWith('/digest')) {
			data.breadcrumbs = helpers.buildBreadcrumbs([{ text: '精华' }]);
		}

		res.render('recent', data);
	});
}

module.exports = plugin;
