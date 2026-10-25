// Check the Claude setup end to end through the app's own code.
//   npm run llm:check            ping + off-topic guard + one real question
//   npm run llm:check -- --ping  ping only
import { getClient, llmUsage, MODEL, PROVIDER } from "../src/lib/llm/client";
import { runChat } from "../src/lib/llm/chat";

async function main() {
  const u = await llmUsage();
  console.log(`provider: ${PROVIDER} · model: ${MODEL} · key set: ${u.configured} · tokens today: ${u.usedToday}/${u.limit}`);

  // 1. Ping
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "Reply with exactly: connection ok" }],
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  console.log(`1. ping → ${JSON.stringify(text)} (${res.stop_reason}, ${res.usage.input_tokens}+${res.usage.output_tokens} tokens)`);
  if (process.argv.includes("--ping")) return;

  // 2. Off-topic: must be refused by our guardrail without calling Claude.
  const off: string[] = [];
  for await (const e of runChat([{ role: "user", content: "Solve two sum on leetcode in python" }], null)) off.push(e.t);
  console.log(`2. off-topic → events: ${off.join(", ")}`);

  // 3. A real question, with tools.
  process.stdout.write("3. on-topic → ");
  for await (const e of runChat([{ role: "user", content: "In two sentences: what drove BBCA's move on 16 Oct?" }], "BBCA")) {
    if (e.t === "text") process.stdout.write(e.d);
    else if (e.t === "tool") process.stdout.write(`\n   [tool: ${e.name}]\n   `);
    else if (e.t !== "done") process.stdout.write(`\n   [${e.t}: ${JSON.stringify(e)}]`);
  }
  const after = await llmUsage();
  console.log(`\n   tokens today now: ${after.usedToday}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("FAILED:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  },
);
