'use strict';

/* global $, window, socket, config, ajaxify, app */

$('document').ready(function () {
	$(window).on('action:ajaxify.end', function (ev, data) {
		if (data.url.match(/^topic\//)) {
			addLabel();
			markPostAsDigest();
		}
	});

	$(window).on('action:topic.tools.load', addHandlers);
	$(window).on('action:post.tools.load', addPostHandlers);

	$(window).on('action:posts.loaded', markPostAsDigest);

	$(window).on('action:composer.loaded', function (ev, data) {
		var isReply = data.hasOwnProperty('composerData') && !data.composerData.isMain;
		if (isReply) {
			return;
		}

		var item = $('<button type="button" class="btn btn-info dropdown-toggle" data-toggle="dropdown"><span class="caret"></span></button><ul class="dropdown-menu pull-right" role="menu"><li><a href="#" data-switch-action="post"><i class="fa fa-fw fa-diamond"></i> 标记为精华</a></li></ul>');
		var actionBar = $('#cmp-uuid-' + data.post_uuid + ' .action-bar');

		item.on('click', 'li', function () {
			$(window).off('action:composer.topics.post').one('action:composer.topics.post', function (ev, data) {
				callMarkAsDigest(data.data.tid, false);
			});
		});

		if (
			config['digest'].forceQuestions === 'on' ||
			(config['digest']['defaultCid_' + data.composerData.cid] === 'on')
		) {
			actionBar.append(item);
		}
	});

	function addHandlers() {
		$('.toggleDigestStatus').on('click', toggleDigestStatus);
	}

	function addLabel() {
		if (ajaxify.data.hasOwnProperty('isDigest') && parseInt(ajaxify.data.isDigest, 10) === 1) {
			require(['components'], function (components) {
				components.get('post/header').prepend('<span class="digested"><i class="fa fa-diamond"></i> 精华</span>');
			});
		}
	}

	function toggleDigestStatus() {
		var tid = ajaxify.data.tid;
		var pid = $(this).parents('[data-pid]').attr('data-pid');
		callMarkAsDigest(tid, pid, true);
	}

	function callMarkAsDigest(tid, pid, refresh) {
		socket.emit('plugins.Digest.toggleDigestStatus', { tid: tid, pid: pid }, function (err, data) {
			if (err) {
				return app.alertError(err);
			}

			app.alertSuccess(data.isDigest ? '帖子已经是精华帖' : '帖子已被标记为普通帖子');
			if (refresh) {
				ajaxify.refresh();
			}
		});
	}

	function markPostAsDigest() {
		$('[component="post"][data-pid="' + ajaxify.data.digestPid + '"]').addClass('isDigest');
	}
});
