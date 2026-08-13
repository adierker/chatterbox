import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	UNTITLED,
	deriveTitle,
	forkTitle,
	sanitizeTitle,
	uniqueTitle,
} from './titles';

describe('sanitizeTitle', () => {
	it('strips characters Obsidian rejects in note names', () => {
		assert.equal(
			sanitizeTitle('Section 7: draft? #wip [notes] | v2'),
			'Section 7 draft wip notes v2',
		);
	});

	it('strips path separators so a title cannot escape the folder', () => {
		// Separators go first, then the leading dots that are left behind.
		assert.equal(sanitizeTitle('../../etc/passwd'), 'etcpasswd');
	});

	it('removes a leading dot so the file is not hidden', () => {
		assert.equal(sanitizeTitle('.hidden'), 'hidden');
	});

	it('removes trailing dots and spaces, which break on Windows', () => {
		assert.equal(sanitizeTitle('Section 7. '), 'Section 7');
	});

	it('falls back when nothing usable is left', () => {
		assert.equal(sanitizeTitle('///'), UNTITLED);
		assert.equal(sanitizeTitle('   '), UNTITLED);
	});
});

describe('deriveTitle', () => {
	it('uses the first line of the first message', () => {
		assert.equal(
			deriveTitle('Does section 7 lose momentum?\n\nMore detail here.'),
			'Does section 7 lose momentum',
		);
	});

	it('collapses runs of whitespace', () => {
		assert.equal(deriveTitle('Too    many     spaces'), 'Too many spaces');
	});

	it('truncates on a word boundary', () => {
		const title = deriveTitle(
			'This is a very long opening question about the structure of section seven and its shape',
		);
		assert.ok(title.length <= 60);
		assert.ok(!title.endsWith(' '));
		assert.equal(title, 'This is a very long opening question about the structure of');
	});

	it('handles an empty message', () => {
		assert.equal(deriveTitle('   '), UNTITLED);
	});
});

describe('forkTitle', () => {
	it('sorts a fork directly under its parent', () => {
		assert.equal(forkTitle('Review', new Set()), 'Review (fork 2)');
	});

	it('increments rather than nesting when forking a fork', () => {
		// Not "Review (fork 2) (fork 2)" — a lineage stays under one name.
		assert.equal(
			forkTitle('Review (fork 2)', new Set(['Review (fork 2)'])),
			'Review (fork 3)',
		);
	});

	it('skips names already taken', () => {
		assert.equal(
			forkTitle('Review', new Set(['Review (fork 2)', 'Review (fork 3)'])),
			'Review (fork 4)',
		);
	});

	it('handles a parent whose title contains brackets', () => {
		assert.equal(
			forkTitle('Section 7 (draft)', new Set()),
			'Section 7 (draft) (fork 2)',
		);
	});
});

describe('uniqueTitle', () => {
	it('leaves a free title alone', () => {
		assert.equal(uniqueTitle('Review', new Set()), 'Review');
	});

	it('counts up past collisions', () => {
		assert.equal(
			uniqueTitle('Review', new Set(['Review', 'Review 2'])),
			'Review 3',
		);
	});
});
