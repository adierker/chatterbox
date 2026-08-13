import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildContextBlock,
	buildSystemMessage,
	estimateTokens,
	formatApprox,
	parseDropText,
} from './context';

describe('buildContextBlock', () => {
	it('is empty when nothing is attached', () => {
		assert.equal(buildContextBlock([]), '');
	});

	it('delimits each note with its path', () => {
		const block = buildContextBlock([
			{ path: 'Reference/Overview.md', content: 'Line one of the note.' },
		]);
		assert.match(block, /--- BEGIN NOTE: Reference\/Overview\.md ---/);
		assert.match(block, /--- END NOTE: Reference\/Overview\.md ---/);
		assert.match(block, /Line one of the note\./);
	});

	it('keeps notes in order and separated', () => {
		const block = buildContextBlock([
			{ path: 'a.md', content: 'first' },
			{ path: 'b.md', content: 'second' },
		]);
		assert.ok(block.indexOf('a.md') < block.indexOf('b.md'));
		assert.match(block, /first\n--- END NOTE: a\.md ---\n\n--- BEGIN NOTE: b\.md ---\nsecond/);
	});

	it('does not use markdown headings, which would collide with note content', () => {
		const block = buildContextBlock([
			{ path: 'a.md', content: '## A heading inside the note' },
		]);
		assert.equal(block.split('\n').filter((l) => l.startsWith('## ')).length, 1);
	});
});

describe('unavailable notes', () => {
	it('says nothing when everything is present', () => {
		const block = buildContextBlock([{ path: 'a.md', content: 'x' }], []);
		assert.doesNotMatch(block, /no longer|not available/i);
	});

	it('names a note the user removed, and why', () => {
		const block = buildContextBlock(
			[{ path: 'a.md', content: 'x' }],
			[{ path: 'Secret.md', reason: 'removed' }],
		);
		assert.match(block, /"Secret\.md" — removed from context by the user/);
	});

	it('distinguishes a note missing from the vault', () => {
		const block = buildContextBlock(
			[],
			[{ path: 'Gone.md', reason: 'missing' }],
		);
		assert.match(block, /"Gone\.md" — renamed or deleted in the vault/);
	});

	it('states earlier replies were not invented', () => {
		const block = buildContextBlock(
			[],
			[{ path: 'Secret.md', reason: 'removed' }],
		);
		// This sentence is the whole point: without it the model concludes it
		// hallucinated whatever the removed note supplied.
		assert.match(block, /not invented detail/);
	});

	it('is emitted even when nothing is attached any more', () => {
		const block = buildContextBlock(
			[],
			[{ path: 'Secret.md', reason: 'removed' }],
		);
		assert.notEqual(block, '');
	});

	it('lists the notes still attached before the ones that are gone', () => {
		const block = buildContextBlock(
			[{ path: 'here.md', content: 'x' }],
			[{ path: 'gone.md', reason: 'removed' }],
		);
		assert.ok(block.indexOf('here.md') < block.indexOf('gone.md'));
	});
});

describe('buildSystemMessage', () => {
	it('returns null when there is no prompt and no context', () => {
		assert.equal(buildSystemMessage('', ''), null);
	});

	it('returns null when both are only whitespace', () => {
		assert.equal(buildSystemMessage('   ', '\n\n'), null);
	});

	it('sends the prompt alone when nothing is attached', () => {
		assert.equal(buildSystemMessage('Be terse.', ''), 'Be terse.');
	});

	it('sends context alone when no prompt is configured', () => {
		assert.equal(buildSystemMessage('', 'CONTEXT'), 'CONTEXT');
	});

	it('puts the prompt before the context', () => {
		assert.equal(
			buildSystemMessage('Be terse.', 'CONTEXT'),
			'Be terse.\n\nCONTEXT',
		);
	});
});

describe('estimateTokens', () => {
	it('approximates four characters per token', () => {
		assert.equal(estimateTokens(400), 100);
	});

	it('rounds up so a short note never reads as zero', () => {
		assert.equal(estimateTokens(1), 1);
	});
});

describe('formatApprox', () => {
	it('leaves small numbers alone', () => {
		assert.equal(formatApprox(812), '812');
	});

	it('abbreviates thousands and millions', () => {
		assert.equal(formatApprox(4200), '4.2k');
		assert.equal(formatApprox(1_300_000), '1.3M');
	});
});

describe('parseDropText', () => {
	it('reads a bare vault path', () => {
		assert.deepEqual(parseDropText('Drafts/07.md'), ['Drafts/07.md']);
	});

	it('unwraps a wikilink', () => {
		assert.deepEqual(parseDropText('[[Characters]]'), ['Characters']);
	});

	it('strips an embed marker', () => {
		assert.deepEqual(parseDropText('![[Characters]]'), ['Characters']);
	});

	it('drops a display alias', () => {
		assert.deepEqual(parseDropText('[[Characters|the cast]]'), [
			'Characters',
		]);
	});

	it('drops a heading reference', () => {
		assert.deepEqual(parseDropText('[[Overview#Detail]]'), ['Overview']);
	});

	it('unwraps a markdown link and decodes escapes', () => {
		assert.deepEqual(parseDropText('[07](Drafts/Section%2007.md)'), [
			'Drafts/Section 07.md',
		]);
	});

	it('handles a multi-file drop, one per line', () => {
		assert.deepEqual(parseDropText('[[A]]\n[[B]]\n\n[[C]]'), ['A', 'B', 'C']);
	});

	it('ignores blank input', () => {
		assert.deepEqual(parseDropText('   \n\n'), []);
	});

	it('passes an obsidian:// URI through for the resolver to handle', () => {
		const uri = 'obsidian://open?vault=Notes&file=Chapters%2F07';
		assert.deepEqual(parseDropText(uri), [uri]);
	});

	it('keeps an absolute filesystem path intact', () => {
		assert.deepEqual(parseDropText('/Users/me/Vault/Drafts/07.md'), [
			'/Users/me/Vault/Drafts/07.md',
		]);
	});
});
