import readline from "node:readline";

// Reads a line from the terminal without echoing it (for passwords).
export function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Echo nothing after the prompt itself so the password isn't shown.
  const output = rl as unknown as { _writeToOutput: (s: string) => void };
  let prompted = false;
  output._writeToOutput = (s) => {
    if (!prompted) {
      process.stdout.write(s);
      prompted = true;
    }
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}
