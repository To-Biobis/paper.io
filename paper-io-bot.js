// paper-io-bot.js – Verbesserte Version

if (process.argv.length < 3) {
	console.log("Usage: node paper-io-bot.js <socket-url> [<name>] [--two-player]");
	process.exit(1);
}

import io from "socket.io-client";
import * as client from "./src/game-client.js";
import { consts } from "./config.js";

const MOVES = [
	[-1, 0], // oben
	[0, 1],  // rechts
	[1, 0],  // unten
	[0, -1]  // links
];

let startFrame = -1, endFrame = -1;
let grid, others, user;
const playerPortion = {};
let claim = [];

// Prüfe ob 2-Spieler Modus aktiviert wurde
const twoPlayerMode = process.argv.includes('--two-player');

// Hilfsfunktion: Korrekte Modulo-Berechnung für Richtungen
const mod = x => ((x % 4) + 4) % 4;

function connect() {
	const prefixes = consts.PREFIXES.split(" ");
	const names = consts.NAMES.split(" ");
	const name =
		process.argv[3] && !process.argv[3].startsWith('--') ?
		process.argv[3] :
		`${prefixes[Math.floor(Math.random() * prefixes.length)]} ${names[Math.floor(Math.random() * names.length)]}`;
	
	client.connectGame(io, process.argv[2], "[BOT] " + name, (success, msg) => {
		if (!success) {
			console.error(msg);
			// Im 2-Spieler Modus längere Wartezeit zwischen Verbindungsversuchen
			setTimeout(connect, twoPlayerMode ? 5000 : 1000);
		}
	}, false, twoPlayerMode);
}

function Loc(row, col) {
	this.row = row;
	this.col = col;
}

function update(frame) {
	if (startFrame === -1) startFrame = frame;
	endFrame = frame;

	// Aktualisiere alle 6 Frames synchronisiert
	if (frame % 6 === (startFrame + 1) % 6) {
		grid = client.grid;
		others = client.getOthers();
		const { row, col } = user;
		let dir = user.currentHeading;
		// Dynamisch anpassbarer Schwellenwert zur Flächenerfassung
		const thres = (.05 + .1 * Math.random()) * consts.GRID_COUNT * consts.GRID_COUNT;

		if (row < 0 || col < 0 || row >= consts.GRID_COUNT || col >= consts.GRID_COUNT) return;

		if (grid.get(row, col) === user) {
			// Wenn wir in unserem Territorium sind
			claim = [];
			// Gewichte: Vorzugsrichtung wird stark bevorzugt, Rückwärtsbewegung wird bestraft
			const weights = [25, 25, 25, 25];
			weights[dir] = 100;
			weights[mod(dir + 2)] = -9999;

			// Beurteile das Feld in allen vier Richtungen
			for (let nd = 0; nd < 4; nd++) {
				for (let S = 1; S < 20; S++) {
					const nr = row + MOVES[nd][0] * S;
					const nc = col + MOVES[nd][1] * S;
					if (nr < 0 || nc < 0 || nr >= consts.GRID_COUNT || nc >= consts.GRID_COUNT) {
						weights[nd] += S > 1 ? -1 : -9999;
					} else {
						if (grid.get(nr, nc) !== user) weights[nd]--;
						// Prüfe, ob ein Gegner in der Nähe ist
						const opponent = others.find(o => o.tail.hitsTail(new Loc(nr, nc)));
						if (opponent) {
							// Eigene Paper.io-Bots werden weniger aggressiv angegriffen
							weights[nd] += opponent.name.indexOf("PAPER") !== -1 ? 3 * (30 - S) : 30 * (30 - S);
						}
					}
				}
			}

			// Wähle eine Richtung basierend auf den Gewichten
			let choices = [];
			for (let d = 0; d < 4; d++) {
				for (let S = 1; S < Math.max(weights[d], 1); S++) {
					choices.push(d);
				}
			}
			dir = choices.length ? choices[Math.floor(Math.random() * choices.length)] : dir;
		} else if (playerPortion[user.num] < thres) {
			// Wenn unser Territorium noch klein ist, generiere einen Landnahmeplan
			if (!claim.length) {
				const breadth = 4 * Math.random() + 2;
				const length = 4 * Math.random() + 2;
				const ccw = 2 * Math.floor(2 * Math.random()) - 1;
				const turns = [dir, mod(dir + ccw), mod(dir + ccw * 2), mod(dir + ccw * 3)];
				const lengths = [breadth, length, breadth + 2 * Math.random() + 1, length];
				turns.forEach((turn, i) => {
					for (let j = 0; j < lengths[i]; j++) {
						claim.push(turn);
					}
				});
			}
			dir = claim.shift();
		} else {
			// Wenn wir außerhalb unseres Territoriums sind, agiere vorsichtiger
			claim = [];
			const weights = [5, 5, 5, 5];
			weights[dir] = 50;
			weights[mod(dir + 2)] = -9999;
			for (let nd = 0; nd < 4; nd++) {
				for (let S = 1; S < 20; S++) {
					const nr = row + MOVES[nd][0] * S;
					const nc = col + MOVES[nd][1] * S;
					if (nr < 0 || nc < 0 || nr >= consts.GRID_COUNT || nc >= consts.GRID_COUNT) {
						weights[nd] += S > 1 ? -1 : -9999;
					} else {
						// Vermeide den eigenen Schwanz
						if (user.tail.hitsTail(new Loc(nr, nc))) {
							weights[nd] += S > 1 ? -(50 - S) : -9999;
						}
						// Bevorzugt das eigene Territorium
						if (grid.get(nr, nc) === user) weights[nd] += 10 + S;
						const opponent = others.find(o => o.tail.hitsTail(new Loc(nr, nc)));
						if (opponent) {
							weights[nd] += opponent.name.indexOf("PAPER") !== -1 ? 3 * (30 - S) : 30 * (30 - S);
						}
					}
				}
			}
			let choices = [];
			for (let d = 0; d < 4; d++) {
				for (let S = 1; S < Math.max(weights[d], 1); S++) {
					choices.push(d);
				}
			}
			dir = choices.length ? choices[Math.floor(Math.random() * choices.length)] : dir;
		}
		client.changeHeading(dir);
	}
}

function calcFavorability(params) {
	return params.portion + params.kills * 50 + params.survival / 100;
}

client.setAllowAnimation(false);
client.setRenderer({
	addPlayer: player => {
		playerPortion[player.num] = 0;
	},
	disconnect: () => {
		const dt = endFrame - startFrame;
		startFrame = -1;
		console.log(`[${new Date()}] Ich bin gestorben... (überlebt: ${dt} Frames.)`);
		console.log(`[${new Date()}] Ich habe ${client.getKills()} Gegner eliminiert.`);
		setTimeout(connect, 5000);
	},
	removePlayer: player => {
		delete playerPortion[player.num];
	},
	setUser: u => {
		user = u;
	},
	update,
	updateGrid: (row, col, before, after) => {
		if (before) playerPortion[before.num]--;
		if (after) playerPortion[after.num]++;
	}
});

connect();
