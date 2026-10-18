/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import { Uri } from 'vscode';
import { getTimelineDiffUris, getWorkspaceTimelinePage, GitTimelineItem } from '../timelineProvider';
import { fromGitUri } from '../uri';

suite('git timeline', () => {
	interface TestCommit {
		readonly hash: string;
		readonly timestamp: number;
	}

	/**
	 * Pages through the workspace timeline of the given repository histories, requesting each page like the provider
	 * does with `git log -n <limit + 1> --skip <skip>`.
	 */
	function getPages(histories: Record<string, TestCommit[]>, limit: number): string[][] {
		const pages: string[][] = [];
		let skipByRoot: Record<string, number> | undefined;
		do {
			const logs = Object.entries(histories)
				.filter(([root]) => skipByRoot === undefined || skipByRoot[root] !== undefined)
				.map(([root, commits]) => {
					const skip = skipByRoot?.[root] ?? 0;
					return { root, skip, commits: commits.slice(skip, skip + limit + 1) };
				});

			const { page, nextSkip } = getWorkspaceTimelinePage(logs, limit, commit => commit.timestamp);
			pages.push(page.map(({ commit }) => commit.hash));
			skipByRoot = nextSkip;
		} while (skipByRoot !== undefined && pages.length < 10);

		return pages;
	}

	test('workspace timeline pages through repositories newest first', () => {
		assert.deepStrictEqual(getPages({
			'/a': [{ hash: 'a3', timestamp: 6 }, { hash: 'a2', timestamp: 4 }, { hash: 'a1', timestamp: 1 }],
			'/b': [{ hash: 'b3', timestamp: 5 }, { hash: 'b2', timestamp: 3 }, { hash: 'b1', timestamp: 2 }],
		}, 2), [['a3', 'b3'], ['a2', 'b2'], ['b1', 'a1']]);
	});

	test('workspace timeline does not skip commits whose log order differs from their timestamps', () => {
		// e.g. author dates when commits were rebased
		assert.deepStrictEqual(getPages({
			'/a': [{ hash: 'A', timestamp: 100 }, { hash: 'B', timestamp: 1 }, { hash: 'C', timestamp: 90 }],
			'/b': [{ hash: 'D', timestamp: 95 }],
		}, 2), [['A', 'D'], ['B', 'C']]);
	});

	suite('open comparison', () => {
		const root = Uri.file(path.join(path.sep, 'repo'));
		const fileAt = (name: string) => Uri.joinPath(root, name);
		const current = fileAt('new.txt');

		function getDiffSides(item: GitTimelineItem) {
			const { originalUri, modifiedUri } = getTimelineDiffUris(item, current);
			return [originalUri, modifiedUri].map(fromGitUri);
		}

		function commitItem(ref: string, previousRef: string, fileName: string, previousFileName: string): GitTimelineItem {
			const item = new GitTimelineItem(ref, previousRef, 'message', 0, ref, 'git:file:commit', root);
			item.fileUri = fileAt(fileName);
			item.previousFileUri = fileAt(previousFileName);
			return item;
		}

		test('compares a commit from before a rename at the old path', () => {
			assert.deepStrictEqual(getDiffSides(commitItem('b', 'a', 'old.txt', 'old.txt')), [
				{ path: fileAt('old.txt').fsPath, ref: 'a' },
				{ path: fileAt('old.txt').fsPath, ref: 'b' },
			]);
		});

		test('compares a rename commit from the old path to the new path', () => {
			assert.deepStrictEqual(getDiffSides(commitItem('c', 'b', 'new.txt', 'old.txt')), [
				{ path: fileAt('old.txt').fsPath, ref: 'b' },
				{ path: current.fsPath, ref: 'c' },
			]);
		});

		test('compares staged changes at the current path', () => {
			const item = new GitTimelineItem('~', 'HEAD', 'Staged Changes', 0, 'index', 'git:file:index', root);
			assert.deepStrictEqual(getDiffSides(item), [
				{ path: current.fsPath, ref: 'HEAD' },
				{ path: current.fsPath, ref: '~' },
			]);
		});
	});
});
