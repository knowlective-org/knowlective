import { LoadingOverlay } from "@/components/loading-overlay";

// While a page is opened, the server reads it (and its access, the sidebar)
// from the database: the whole screen shows that it's loading.
export default function PageLoading() {
  return <LoadingOverlay />;
}
