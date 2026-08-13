import type { ContextState } from './useSession';

/** Contents of the Context drawer: the attached notes and anything that left. */
export function ContextDrawer({ context }: { context: ContextState }) {
	const { paths, missing, sent, unavailable, size } = context;

	return (
		<div className="chatterbox-drawer">
			{paths.length === 0 ? (
				<div className="chatterbox-drawer-empty">
					Nothing attached. Drag a note in, press +, or type @ in the
					composer.
				</div>
			) : (
				<div className="chatterbox-pills">
					{paths.map((path) => (
						<Pill
							key={path}
							path={path}
							missing={missing.includes(path)}
							locked={sent.has(path)}
							onRemove={() => {
								context.remove(path);
							}}
						/>
					))}
				</div>
			)}

			{unavailable.length > 0 && (
				<div className="chatterbox-gone">
					{unavailable.map((note) => (
						<div key={note.path} title={note.path}>
							{note.path.split('/').pop() ?? note.path} —{' '}
							{note.reason === 'removed'
								? 'removed from context'
								: 'missing from the vault'}
							. The model is told it existed.
						</div>
					))}
				</div>
			)}

			{size.notes > 0 && (
				<div className="chatterbox-size">
					~{size.approxTokens.toLocaleString()} tokens across{' '}
					{size.notes === 1 ? '1 note' : `${String(size.notes)} notes`}
				</div>
			)}
		</div>
	);
}

function Pill({
	path,
	missing,
	locked,
	onRemove,
}: {
	path: string;
	missing: boolean;
	locked: boolean;
	onRemove: () => void;
}) {
	const name = path.split('/').pop() ?? path;
	const className = [
		'chatterbox-pill',
		missing ? 'chatterbox-pill-missing' : '',
		locked ? 'chatterbox-pill-sent' : '',
	]
		.filter((part) => part !== '')
		.join(' ');

	return (
		<span
			className={className}
			title={
				missing
					? `Missing: ${path}`
					: locked
						? `${path} — already sent in this chat`
						: path
			}
		>
			{name}
			<button
				className="chatterbox-pill-remove"
				onClick={onRemove}
				aria-label={`Remove ${name}`}
			>
				×
			</button>
		</span>
	);
}
