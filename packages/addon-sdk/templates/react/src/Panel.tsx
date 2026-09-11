import { useEffect, useState } from 'react';
import { gameCharacter, type CharacterRow } from '@osu-idle/addon-sdk';

export default function Panel({
	open,
	version,
	onClose,
}: {
	open: boolean;
	version: string;
	onClose: () => void;
}) {
	const [character, setCharacter] = useState<CharacterRow>();

	// Re-read when opened: the client writes skill levels back to this row after
	// every play, so a value read once at boot goes stale.
	useEffect(() => {
		if (open) void gameCharacter.live().then(setCharacter);
	}, [open]);

	return (
		<div style={{ display: open ? 'contents' : 'none' }} aria-hidden={!open}>
			<div className="backdrop" onClick={onClose} />
			<div className="panel" role="dialog" aria-label="__ADDON_NAME__">
				<header>
					<h1>__ADDON_NAME__</h1>
					<span className="spacer" />
					<span className="hint">v{version}</span>
					<button onClick={onClose}>Close</button>
				</header>

				<div className="body">
					{character
						? <p>Playing as <strong>{character.name}</strong> (level {character.overallLevel}).</p>
						: <p>Looking for your character...</p>}
					<p>Edit <code>src/Panel.tsx</code> to build your add-on.</p>
				</div>
			</div>
		</div>
	);
}
