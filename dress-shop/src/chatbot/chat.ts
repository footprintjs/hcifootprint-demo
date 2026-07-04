/**
 * CLI front-end for the shop assistant. Prefer `npm run serve` for the browser
 * UI; this is the terminal version. Shares all agent/HITL logic with the web
 * server via ./assistant.ts. Run: npm run chat (reads .env for ANTHROPIC_API_KEY).
 */
import readline from 'node:readline/promises';
import { DressShop } from '../app/shop.js';
import { connectShop } from '../agent-layer/connect.js';
import { connectOverMcp } from '../agent-layer/mcp-bridge.js';
import { loadDotEnv } from './env.js';
import { createAssistant } from './assistant.js';

loadDotEnv();

async function main(): Promise<void> {
  const shop = new DressShop();
  const session = connectShop(shop);
  const assistant = createAssistant(session, await connectOverMcp(session)); // driven over MCP
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  session.onGap((gap) =>
    console.log(`  [gap ledger: ${gap.kind} ${gap.rejectionReason ?? gap.reason ?? ''}]`),
  );
  console.log('dress-shop assistant — chat normally; /state /brief /gaps /quit are local.\n');

  for (;;) {
    const line = (await rl.question('you> ')).trim();
    if (!line) continue;
    if (line === '/quit') break;
    if (line === '/state') {
      console.log(JSON.stringify(session.state(), null, 2));
      continue;
    }
    if (line === '/brief') {
      console.log(session.contextBrief().text);
      continue;
    }
    if (line === '/gaps') {
      console.log(JSON.stringify(session.gaps(), null, 2));
      continue;
    }

    let turn = await assistant.send(line);
    while (turn.type === 'confirm') {
      const answer = (await rl.question(`confirm> ${turn.question.summary} (yes/no) `)).trim().toLowerCase();
      const approved = answer === 'y' || answer === 'yes';
      turn = await assistant.confirm(approved, answer);
    }
    console.log(`assistant> ${turn.text}`);
  }
  rl.close();
}

main().catch((error) => {
  if (String(error).toLowerCase().includes('api key') || String(error).includes('401')) {
    console.error('No usable Claude API key. Copy .env.template to .env and add ANTHROPIC_API_KEY.');
    process.exit(1);
  }
  throw error;
});
