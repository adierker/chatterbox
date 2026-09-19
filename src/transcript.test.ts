import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	TranscriptError,
	parseTranscript,
	serializeTranscript,
} from './transcript';
import { Transcript } from './types';

const CANONICAL = `---
model: "z-ai/glm-5.2"
temperature: 0.7
top_p: 0.95
max_tokens: 4096
reasoning: true
reasoning_effort: high
web_search: true
system_prompt: "Standing instructions for this conversation."
context:
  - "Reference/Overview.md"
  - "Drafts/Section 07.md"
removed_context:
  - "Reference/Superseded.md"
created: 2026-08-12T15:23:19
forked_from: "X - Chatterbox/Section 07 review.md"
forked_at: 6
---

<!--msg:user id=a1b2c3-->

Does section 7 lose momentum in the middle?

<!--msg:assistant id=d4e5f6 model=z-ai/glm-5.2 temperature=0.7 web_search=true-->

The middle section moves slowly, but that may be intentional.
`;

const MINIMAL = `---
model: "z-ai/glm-5.2"
created: 2026-08-12T15:23:19
---

<!--msg:user id=a1b2c3-->

Hello.
`;

describe('round trip', () => {
	it('reproduces a full file byte for byte', () => {
		assert.equal(
			serializeTranscript(parseTranscript(CANONICAL)),
			CANONICAL,
		);
	});

	it('reproduces a minimal file byte for byte', () => {
		assert.equal(serializeTranscript(parseTranscript(MINIMAL)), MINIMAL);
	});

	it('is stable across repeated cycles', () => {
		const once = serializeTranscript(parseTranscript(CANONICAL));
		const twice = serializeTranscript(parseTranscript(once));
		assert.equal(once, twice);
	});

	it('survives CRLF input', () => {
		const parsed = parseTranscript(CANONICAL.replace(/\n/g, '\r\n'));
		assert.equal(serializeTranscript(parsed), CANONICAL);
	});
});

describe('parseTranscript', () => {
	it('reads metadata', () => {
		const { meta } = parseTranscript(CANONICAL);
		assert.equal(meta.model, 'z-ai/glm-5.2');
		assert.equal(meta.systemPrompt, 'Standing instructions for this conversation.');
		assert.deepEqual(meta.context, [
			'Reference/Overview.md',
			'Drafts/Section 07.md',
		]);
		assert.deepEqual(meta.removedContext, ['Reference/Superseded.md']);
		assert.equal(meta.forkedFrom, 'X - Chatterbox/Section 07 review.md');
		assert.equal(meta.forkedAt, 6);
	});

	it('reads parameters from frontmatter', () => {
		const { meta } = parseTranscript(CANONICAL);
		assert.deepEqual(meta.parameters, {
			temperature: 0.7,
			topP: 0.95,
			maxTokens: 4096,
			reasoning: true,
			reasoningEffort: 'high',
			webSearch: true,
		});
	});

	it('leaves unset parameters absent rather than defaulted', () => {
		const { meta } = parseTranscript(MINIMAL);
		assert.deepEqual(meta.parameters, {});
		assert.equal(meta.systemPrompt, null);
	});

	it('reads the per-message parameter stamp', () => {
		const { messages } = parseTranscript(CANONICAL);
		assert.equal(messages[1]?.model, 'z-ai/glm-5.2');
		assert.deepEqual(messages[1]?.parameters, {
			temperature: 0.7,
			webSearch: true,
		});
	});

	it('accepts hand-written unquoted values', () => {
		const handEdited = MINIMAL.replace(
			'model: "z-ai/glm-5.2"',
			'model: z-ai/glm-5.2',
		);
		assert.equal(parseTranscript(handEdited).meta.model, 'z-ai/glm-5.2');
	});

	it('keeps a hand-edited message body', () => {
		const edited = MINIMAL.replace('Hello.', 'Hello, and also this.');
		assert.equal(
			parseTranscript(edited).messages[0]?.content,
			'Hello, and also this.',
		);
	});

	it('drops a message that was deleted from the file', () => {
		const { messages } = parseTranscript(MINIMAL);
		assert.equal(messages.length, 1);
	});

	it('preserves multi-paragraph content', () => {
		const parsed = parseTranscript(
			MINIMAL.replace('Hello.', 'One.\n\nTwo.\n\nThree.'),
		);
		assert.equal(parsed.messages[0]?.content, 'One.\n\nTwo.\n\nThree.');
	});

	it('preserves markdown headings inside a message', () => {
		const parsed = parseTranscript(
			MINIMAL.replace('Hello.', '## A heading\n\nBody text.'),
		);
		assert.equal(parsed.messages[0]?.content, '## A heading\n\nBody text.');
	});
});

describe('user-edited replies', () => {
	const EDITED = `---
model: "z-ai/glm-5.2"
created: 2026-08-12T15:23:19
---

<!--msg:user id=a1b2c3-->

Hello.

<!--msg:assistant id=d4e5f6 model=z-ai/glm-5.2 edited=true-->

Text supplied by the user.
`;

	it('round-trips the edited flag', () => {
		assert.equal(serializeTranscript(parseTranscript(EDITED)), EDITED);
	});

	it('marks the message so the transcript does not credit the model', () => {
		assert.equal(parseTranscript(EDITED).messages[1]?.edited, true);
	});

	it('leaves untouched replies unflagged', () => {
		assert.equal(parseTranscript(CANONICAL).messages[1]?.edited, undefined);
	});
});

describe('unknown frontmatter', () => {
	const withExtra = MINIMAL.replace(
		'created: 2026-08-12T15:23:19',
		'created: 2026-08-12T15:23:19\ncssclass: wide',
	);

	it('keeps keys it does not recognise', () => {
		assert.deepEqual(parseTranscript(withExtra).meta.unknown, [
			'cssclass: wide',
		]);
	});

	it('writes them back rather than discarding them', () => {
		assert.match(
			serializeTranscript(parseTranscript(withExtra)),
			/cssclass: wide/,
		);
	});
});

describe('failing loudly', () => {
	it('rejects a file with no frontmatter', () => {
		assert.throws(
			() => parseTranscript('<!--msg:user id=a-->\n\nHi\n'),
			TranscriptError,
		);
	});

	it('rejects unclosed frontmatter', () => {
		assert.throws(() => parseTranscript('---\nmodel: "x"\n'), TranscriptError);
	});

	it('rejects frontmatter with no model', () => {
		assert.throws(
			() => parseTranscript('---\ncreated: 2026-01-01\n---\n'),
			TranscriptError,
		);
	});

	it('rejects a delimiter with no id', () => {
		assert.throws(
			() => parseTranscript('---\nmodel: "x"\n---\n\n<!--msg:user-->\n\nHi\n'),
			/missing its id/,
		);
	});

	it('rejects an unknown role', () => {
		assert.throws(
			() =>
				parseTranscript(
					'---\nmodel: "x"\n---\n\n<!--msg:system id=a-->\n\nHi\n',
				),
			/Unknown message role/,
		);
	});

	it('rejects an unrecognised delimiter attribute', () => {
		assert.throws(
			() =>
				parseTranscript(
					'---\nmodel: "x"\n---\n\n<!--msg:user id=a bogus=1-->\n\nHi\n',
				),
			/Unrecognised attribute/,
		);
	});

	it('rejects content sitting before the first delimiter', () => {
		assert.throws(
			() =>
				parseTranscript(
					'---\nmodel: "x"\n---\n\nStray text.\n\n<!--msg:user id=a-->\n\nHi\n',
				),
			/before the first message delimiter/,
		);
	});

	it('rejects a non-numeric temperature', () => {
		assert.throws(
			() =>
				parseTranscript(
					'---\nmodel: "x"\ntemperature: warm\n---\n\n<!--msg:user id=a-->\n\nHi\n',
				),
			/must be a number/,
		);
	});

	it('refuses to write content that would corrupt the file', () => {
		const transcript: Transcript = {
			meta: {
				model: 'x',
				systemPrompt: null,
				context: [],
				removedContext: [],
				created: '2026-01-01',
				forkedFrom: null,
				forkedAt: null,
				parameters: {},
				unknown: [],
			},
			messages: [
				{
					id: 'a',
					role: 'user',
					content: 'Look:\n<!--msg:assistant id=zz-->\nnot really',
				},
			],
		};
		assert.throws(() => serializeTranscript(transcript), /corrupt/);
	});
});
