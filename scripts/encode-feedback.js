// Encodes the agent feedback report drafts into review form URLs.
const drafts = [
  {
    schemaVersion: 5,
    triggerReason: "non-obvious-workaround",
    title: "A favicon placed in the public folder is silently shadowed by the app folder metadata file",
    setup: {
      mode: "production-build",
      bundler: "turbopack",
      relevantFeatures: ["App Router metadata files", "public folder assets"],
    },
    steps: [
      "Create an App Router project whose root route segment contains no favicon.ico, and place a custom favicon.ico file in the public folder.",
      "Build the project, start the production server, and request the favicon route.",
      "Inspect the returned bytes and compare them with the file written to the public folder.",
    ],
    observed: [
      "The favicon route returned a 15086-byte default framework icon instead of the 1330-byte custom file placed in the public folder.",
      "No build warning or runtime warning indicated that the file in the public folder was never used.",
    ],
    expected:
      "A favicon.ico placed in the public folder should be served at the favicon route, or the build should warn that a file in the root route segment takes precedence.",
    comparison:
      "Writing the same image to the root route segment as favicon.ico made the framework serve it at the favicon route instead.",
    frequency: "once",
    outcome: "worked-around",
    nextVersion: "16.4.3",
    agent: "claude-sonnet-5-5",
  },
  {
    schemaVersion: 5,
    triggerReason: "documentation-mismatch",
    title: "The official PWA guide install prompt example fails the react-hooks/set-state-in-effect lint rule",
    setup: {
      mode: "production-build",
      bundler: "turbopack",
      relevantFeatures: ["PWA guide", "eslint-config-next"],
    },
    steps: [
      "Enable eslint-config-next in an App Router project and copy the install prompt component from the official progressive web apps guide.",
      "The example records the beforeinstallprompt event by calling a state setter directly inside a useEffect callback.",
      "Run the project linter and inspect the reported error for that line.",
    ],
    observed: [
      "The lint rule react-hooks/set-state-in-effect reported an error for the state setter call inside the useEffect of the documented example.",
      "The guide does not mention this lint rule or provide an alternative that satisfies it.",
    ],
    expected:
      "The documented example should satisfy the lint rules that the recommended project configuration enables, or the guide should offer an alternative pattern.",
    comparison:
      "Moving the install state into an external store read through useSyncExternalStore satisfied the linter with the same behavior.",
    frequency: "once",
    outcome: "worked-around",
    nextVersion: "16.4.3",
    agent: "claude-sonnet-5-5",
  },
];

for (const draft of drafts) {
  const json = JSON.stringify(draft);
  const b64 = Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  console.log(`https://nextjs.org/agent-feedback#report=${b64}`);
}
