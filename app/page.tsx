import { connection } from "next/server";
import TeachingApp from "./teaching-app";
import { upstreamLabel } from "./lib/api-upstream";

// The page is a thin server component so it can read the configured backend
// address on the server. The address is passed down as a prop, which keeps
// the API configuration out of the client bundle.
//
// `connection()` stops the prerendering here, so the page is rendered per
// request and the address always reflects the environment the server is
// actually running with — changing TEACHING_API_URL takes effect
// immediately, without a rebuild.
//
// `instant = false` allows this route to block on the request instead of
// requiring a Suspense boundary.
export const instant = false;

export default async function Home() {
  await connection();
  return <TeachingApp apiAddress={upstreamLabel()} />;
}
