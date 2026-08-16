import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	UNTITLED,
	datePrefix,
	deriveTitle,
	existingDatePrefix,
	forkTitle,
	sanitizeTitle,
	stripDatePrefix,
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

describe('date prefixes', () => {
	it('formats as YY-MM-DD with a dash separator', () => {
		assert.equal(datePrefix(new Date(2026, 7, 16)), '26-08-16 - ');
	});

	it('pads single-digit months and days', () => {
		assert.equal(datePrefix(new Date(2026, 0, 5)), '26-01-05 - ');
	});

	it('sorts chronologically as plain text', () => {
		const dates = [
			datePrefix(new Date(2026, 11, 1)),
			datePrefix(new Date(2026, 0, 5)),
			datePrefix(new Date(2025, 5, 9)),
		];
		assert.deepEqual([...dates].sort(), [
			'25-06-09 - ',
			'26-01-05 - ',
			'26-12-01 - ',
		]);
	});

	it('strips a prefix, leaving an unprefixed title alone', () => {
		assert.equal(stripDatePrefix('26-08-16 - Pacing'), 'Pacing');
		assert.equal(stripDatePrefix('Pacing'), 'Pacing');
	});

	it('strips the older separator-less prefix too', () => {
		// Files written before the dash was added must not end up doubled.
		assert.equal(stripDatePrefix('26-08-16 Pacing'), 'Pacing');
	});

	it('does not mistake a date inside the title for a prefix', () => {
		assert.equal(
			stripDatePrefix('Notes on 26-08-16 timeline'),
			'Notes on 26-08-16 timeline',
		);
	});

	it('reports the prefix a file already carries', () => {
		assert.equal(existingDatePrefix('26-08-16 - Pacing'), '26-08-16 - ');
		assert.equal(existingDatePrefix('Pacing'), '');
	});

	it('keeps an old file\u2019s date but normalises its separator', () => {
		assert.equal(existingDatePrefix('26-08-16 Pacing'), '26-08-16 - ');
	});
});

describe('forkTitle', () => {
	it('dates a fork when it diverged, not when the parent started', () => {
		assert.equal(
			forkTitle('26-08-10 - Pacing', new Set(), '26-08-16 - '),
			'26-08-16 - Pacing (fork 2)',
		);
	});

	it('increments the parent fork counter while re-dating', () => {
		assert.equal(
			forkTitle('26-08-10 - Pacing (fork 2)', new Set(), '26-08-16 - '),
			'26-08-16 - Pacing (fork 3)',
		);
	});

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
