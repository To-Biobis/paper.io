// Bot.js – Verbesserte Version

if (process.argv.length < 3) {
	console.log("Usage: node Bot.js <socket-url> [<name>] [--two-player]");
	process.exit(1);
}

import { Grid } from "./src/core";
import client from "./src/game-client";
import { consts } from "./config.js";

// Prüfe ob 2-Spieler Modus aktiviert wurde
const twoPlayerMode = process.argv.includes('--two-player');

const MOVES = [
	[-1, 0], // oben
	[0, 1],  // rechts
	[1, 0],  // unten
	[0, -1]  // links
];

const AGGRESSIVE = Math.random();
const THRESHOLD = 10;

// Optimierung: Gene Pool Parameter initialisieren
let coeffs = [0.6164, -2.5194, 0.9199, -1.2159, -3.0729, 5, 4];

let startFrame = -1, endFrame = -1;
let grid, others, user;
const playerPortion = {};

// Definiere Distanztypen mit klaren Check-Methoden und Koeffizienten
const DIST_TYPES = {
	land: {
		check: loc => grid.get(loc.row, loc.col) === user,
		coeff: () => coeffs[0]
	},
	tail: {
		check: loc => tail(user, loc),
		coeff: () => coeffs[1]
	},
	oTail: {
		check: foundProto(tail),
		coeff: () => AGGRESSIVE * coeffs[2]
	},
	other: {
		check: foundProto((other, loc) => other.row === loc.row && other.col === loc.col),
		coeff: () => (1 - AGGRESSIVE) * coeffs[3]
	},
	edge: {
		check: loc =>
			loc.row <= 1 || loc.col <= 1 || loc.row >= consts.GRID_COUNT - 1 || loc.col >= consts.GRID_COUNT - 1,
		coeff: () => coeffs[4]
	}
};

function generateLandDirections() {
	// Verbessert: modularer Ansatz für zufällige Landnahmerichtungen
	const mod = x => ((x % 4) + 4) % 4;
	const breadth = Math.floor(Math.random() * coeffs[5]) + 1;
	const spread = Math.floor(Math.random() * coeffs[6]) + 1;
	const extra = Math.floor(Math.random() * 2) + 1;
	const ccw = Math.floor(Math.random() * 2) * 2 - 1;
	const dir = user.currentHeading;
	const turns = [dir, mod(dir + ccw), mod(dir + ccw * 2), mod(dir + ccw * 3)];
	const lengths = [breadth, spread, breadth + extra, spread];
	const moves = [];
	turns.forEach((turn, i) => {
		for (let j = 0; j < lengths[i]; j++) {
			moves.push(turn);
		}
	});
	return moves;
}

function foundProto(func) {
	return loc => others.some(other => func(other, loc));
}

function connect() {
	const prefixes = consts.PREFIXES.split(" ");
	const names = consts.NAMES.split(" ");
	const name =
		(process.argv[3] && !process.argv[3].startsWith('--')) ?
		process.argv[3] :
		`${prefixes[Math.floor(Math.random() * prefixes.length)]} ${names[Math.floor(Math.random() * names.length)]}`;
	
	client.connectGame(process.argv[2], "[BOT] " + name, (success, msg) => {
		if (!success) {
			console.error(msg);
			// Im 2-Spieler Modus längere Wartezeit zwischen Verbindungsversuchen
			setTimeout(connect, twoPlayerMode ? 5000 : 1000);
		}
	}, false, twoPlayerMode);
}

function Loc(row, col, step = 0) {
	this.row = row;
	this.col = col;
	this.step = step;
}

// Vektorprojektion: Projekte b auf a
function project(a, b) {
	const factor = (b[0] * a[0] + b[1] * a[1]) / (a[0] * a[0] + a[1] * a[1]);
	return [factor * a[0], factor * a[1]];
}

function tail(player, loc) {
	return player.tail.hitsTail(loc);
}

// Traversiere ein lokales Raster, um Richtungsgewichte zu berechnen
function traverseGrid(dir) {
	const steps = new Array(consts.GRID_COUNT * consts.GRID_COUNT).fill(-1);
	const distWeights = Object.keys(DIST_TYPES).reduce((acc, type) => {
		acc[type] = 0;
		return acc;
	}, {});

	const { row, col } = user;
	const range = 10; // Suchbereich
	for (let offset = -range; offset <= range; offset++) {
		for (let off2 = -range; off2 <= range; off2++) {
			const loc = { row: row + offset, col: col + off2 };
			if (loc.row < 0 || loc.row >= consts.GRID_COUNT || loc.col < 0 || loc.col >= consts.GRID_COUNT) continue;
			for (const type in DIST_TYPES) {
				if (DIST_TYPES[type].check(loc)) {
					// Gewichtung abhängig von Entfernung (je näher, desto höher)
					const dist = Math.max(Math.abs(offset), Math.abs(off2));
					distWeights[type] += (THRESHOLD - dist) / (dist + 1);
				}
			}
		}
	}
	return distWeights;
}

function printGrid() {
	const chars = new Grid(consts.GRID_COUNT);
	for (let r = 0; r < consts.GRID_COUNT; r++) {
		for (let c = 0; c < consts.GRID_COUNT; c++) {
			if (tail(user, { row: r, col: c })) {
				chars.set(r, c, "t");
			} else {
				const owner = grid.get(r, c);
				chars.set(r, c, owner ? "" + owner.num % 10 : ".");
			}
		}
	}
	others.forEach(p => {
		chars.set(p.row, p.col, "x");
	});
	chars.set(user.row, user.col, "^>V<"[user.currentHeading]);
	let str = "";
	for (let r = 0; r < consts.GRID_COUNT; r++) {
		str += "\n";
		for (let c = 0; c < consts.GRID_COUNT; c++) {
			str += chars.get(r, c);
		}
	}
	console.log(str);
}

function update(frame) {
	if (startFrame === -1) startFrame = frame;
	endFrame = frame;
	// Aktualisiere einmal pro 6 Frames
	if (frame % 6 === 1) {
		grid = client.grid;
		others = client.getOthers();
		// Optional: printGrid();

		// Berechne Gewichte für ausgewählte Richtungen
		const weights = [0, 0, 0, 0];
		[3, 0, 1].forEach(offset => {
			let dir = (offset + user.currentHeading) % 4;
			const distWeights = traverseGrid(dir);
			let weight = 0;
			for (const type in DIST_TYPES) {
				weight += distWeights[type] * DIST_TYPES[type].coeff();
			}
			weights[dir] = weight;
		});

		// Bestrafe den Rückwärtsgang
		const low = Math.min(0, ...weights);
		weights[(user.currentHeading + 2) % 4] = low;

		// Normalisiere Gewichte und wähle eine Richtung basierend auf Zufall
		let total = weights.reduce((acc, val) => acc + (val - low * (1 + Math.random())), 0);
		if (total === 0) {
			// Fallback: leicht gewichten
			[ -1, 0, 1 ].forEach(offset => {
				let d = (user.currentHeading + offset + 4) % 4;
				weights[d] = 1;
				total++;
			});
		}

		let choice = Math.random() * total;
		let d = 0;
		while (choice > weights[d]) {
			choice -= weights[d];
			d++;
		}
		client.changeHeading(d);
	}
}

// Berechne eine einfache Favorabilitätsmetrik für den genetischen Ansatz
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
		// Optimierter genetischer Update – erfolgreicher Bot beeinflusst die Mutation stärker
		const params = {
			portion: playerPortion[user.num] || 0,
			kills: client.getKills(),
			survival: dt
		};
		const mutationStrength = Math.min(10, Math.pow(2, calcFavorability(params)));
		coeffs = coeffs.map(c => c + (Math.random() * 2 - 1) * mutationStrength);
		connect();
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
