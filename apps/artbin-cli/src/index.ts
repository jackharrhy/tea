import { parse } from "@bomb.sh/args";

const args = parse(process.argv.slice(2));
const command = args._[0];

async function main() {
  if (args.version || command === "version") {
    console.log(`artbin ${CLI_VERSION}`);
    return;
  }

  switch (command) {
    case "login": {
      const { login } = await import("./commands/login.ts");
      await login(args);
      break;
    }
    case "logout": {
      const { logout } = await import("./commands/logout.ts");
      await logout();
      break;
    }
    case "scan": {
      const { scan } = await import("./commands/scan.ts");
      await scan(args);
      break;
    }
    case "import": {
      const { importCmd } = await import("./commands/import.ts");
      await importCmd(args);
      break;
    }
    case "add": {
      const { add } = await import("./commands/add.ts");
      await add(args);
      break;
    }
    case "folders": {
      const { folderCommands } = await import("./commands/folders.ts");
      await folderCommands(args);
      break;
    }
    case "pull": {
      const { pull } = await import("./commands/pull.ts");
      await pull(args);
      break;
    }
    default:
      console.log(`artbin - game asset manager CLI

Usage:
  artbin login [server-url]   Authenticate with the artbin server
  artbin logout               Clear stored credentials
  artbin scan <path>          Scan a directory for game assets
  artbin import <path>        Upload game assets to the server
  artbin add <path>           Upload a folder of files (no filtering)
  artbin folders <command>    Inspect and organize server folders
  artbin pull <slug>          Download a server folder as a ZIP

Options:
  --help    Show this help message
  --version Show version`);
      if (command && command !== "help") {
        process.exit(1);
      }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
