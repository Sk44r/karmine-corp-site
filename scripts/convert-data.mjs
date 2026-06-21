import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

const rootDir = process.cwd();

const sourceDir = path.join(rootDir, "data-source");
const outputDir = path.join(rootDir, "src", "data");

const resultsCsvPath = path.join(sourceDir, "results.csv");
const playersCsvPath = path.join(sourceDir, "players.csv");

const resultsJsonPath = path.join(outputDir, "results.json");
const playersJsonPath = path.join(outputDir, "players.json");

function clean(value) {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getValue(row, possibleNames) {
  for (const name of possibleNames) {
    if (row[name] !== undefined && clean(row[name]) !== "") {
      return row[name];
    }
  }

  return "";
}

function parseBoolean(value) {
  const normalized = clean(value).toLowerCase();

  return ["yes", "y", "true", "1", "oui", "o"].includes(normalized);
}

function parseNumber(value) {
  const cleaned = clean(value);

  if (!cleaned) {
    return null;
  }

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  const raw = clean(value);

  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const frenchDateMatch = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);

  if (frenchDateMatch) {
    let [, day, month, year] = frenchDateMatch;

    if (year.length === 2) {
      year = `20${year}`;
    }

    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return raw;
}

function parsePlacementFromLabel(value) {
  const label = clean(value);

  if (!label) {
    return {
      placementLabel: "",
      placementMin: null,
      placementMax: null,
    };
  }

  const normalized = label
    .replace(/#/g, "")
    .replace(/st|nd|rd|th/gi, "")
    .replace(/[–—]/g, "-");

  const numbers = normalized.match(/\d+/g)?.map(Number) ?? [];

  if (numbers.length === 0) {
    return {
      placementLabel: label,
      placementMin: null,
      placementMax: null,
    };
  }

  return {
    placementLabel: label,
    placementMin: Math.min(...numbers),
    placementMax: Math.max(...numbers),
  };
}

function parsePlacement(row) {
  const placementLabel = clean(getValue(row, ["PlacementLabel", "Place", "Placement"]));
  const parsedFromLabel = parsePlacementFromLabel(placementLabel);

  const placementMinFromColumn = parseNumber(getValue(row, ["PlacementMin"]));
  const placementMaxFromColumn = parseNumber(getValue(row, ["PlacementMax"]));

  const placementMin = placementMinFromColumn ?? parsedFromLabel.placementMin;
  const placementMax =
    placementMaxFromColumn ??
    parsedFromLabel.placementMax ??
    placementMin;

  return {
    placementLabel: placementLabel || parsedFromLabel.placementLabel,
    placementMin,
    placementMax,
  };
}

function parsePlayers(value) {
  const raw = clean(value);

  if (!raw) {
    return [];
  }

  return raw
    .split(";")
    .map((player) => clean(player))
    .filter(Boolean);
}

function parseList(value) {
  const raw = clean(value);

  if (!raw) {
    return [];
  }

  return raw
    .split(";")
    .map((item) => clean(item))
    .filter(Boolean);
}

function parseBirthDate(value) {
  return parseDate(value);
}

async function readCsv(filePath) {
  const content = await fs.readFile(filePath, "utf8");

  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });
}

function convertResults(rows) {
  return rows
    .map((row, index) => {
      const placement = parsePlacement(row);

      return {
        id: `result-${String(index + 1).padStart(3, "0")}`,
        game: clean(getValue(row, ["Game"])),
        teamName: clean(getValue(row, ["TeamName", "Team", "Structure"])),
        resultTitle: clean(getValue(row, ["ResultTitle", "Title won", "Achievement"])),
        showInTrophyCabinet: parseBoolean(
          getValue(row, ["ShowInTrophyCabinet", "Cup", "IsMajor"])
        ),
        placementLabel: placement.placementLabel,
        placementMin: placement.placementMin,
        placementMax: placement.placementMax,
        date: parseDate(getValue(row, ["Date"])),
        players: parsePlayers(getValue(row, ["Players", "Player /Roster", "Roster"])),
        competition: clean(getValue(row, ["Competition"])),
        sourceUrl: clean(getValue(row, ["SourceUrl", "Links", "Link"])),
        notes: clean(getValue(row, ["Notes"])),
      };
    })
    .filter((result) => result.game || result.resultTitle);
}

function convertPlayers(rows) {
  return rows
    .map((row, index) => {
      const country = clean(getValue(row, ["Country", "Pays"]));
      const countryCode = clean(
        getValue(row, ["CountryCode", "Country code", "Code pays"])
      ).toUpperCase();

      return {
        id: `player-${String(index + 1).padStart(3, "0")}`,
        game: clean(getValue(row, ["Game"])),
        nickname: clean(getValue(row, ["Nickname", "Pseudo"])),
        firstName: clean(getValue(row, ["FirstName", "First name", "Prénom", "Prenom"])),
        lastName: clean(getValue(row, ["LastName", "Last name", "Nom"])),
        country,
        countryCode,
        countries: parseList(country),
        countryCodes: parseList(countryCode).map((code) => code.toUpperCase()),
        role: clean(getValue(row, ["Role", "Rôle"])),
        status: clean(getValue(row, ["Status", "Statut"])),
        birthDate: parseBirthDate(
          getValue(row, ["BirthDate", "Birth Date", "Date de naissance"])
        ),
        imageUrl: clean(getValue(row, ["ImageUrl", "Image URL"])),
        socialUrl: clean(getValue(row, ["SocialUrl", "Social URL", "Twitter", "X"])),
        notes: clean(getValue(row, ["Notes"])),
      };
    })
    .filter((player) => player.nickname || player.firstName || player.lastName);
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const resultsRows = await readCsv(resultsCsvPath);
  const playersRows = await readCsv(playersCsvPath);

  const results = convertResults(resultsRows);
  const players = convertPlayers(playersRows);

  await fs.writeFile(resultsJsonPath, JSON.stringify(results, null, 2), "utf8");
  await fs.writeFile(playersJsonPath, JSON.stringify(players, null, 2), "utf8");

  console.log(`${results.length} résultats exportés vers src/data/results.json`);
  console.log(`${players.length} joueurs exportés vers src/data/players.json`);
  console.log("Conversion terminée.");
}

main().catch((error) => {
  console.error("Erreur pendant la conversion :");
  console.error(error.message);
  process.exit(1);
});