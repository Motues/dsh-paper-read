/** Values both halves must agree on. */

/** Where the host mounts its HTTP surface, and the browser's base URL. */
export const ROUTE_PATH = '/api/paperreader'
export const API_BASE = ROUTE_PATH
export const PREFIX = `${ROUTE_PATH}/`

/** Path of the pdf.js worker served by the host. */
export const PDF_WORKER_PATH = `${ROUTE_PATH}/static/pdf.worker.min.mjs`

/** Path of the KaTeX stylesheet served by the host (fonts live beside it). */
export const KATEX_CSS_PATH = `${ROUTE_PATH}/static/katex/katex.min.css`

/** Default number of papers shown on the recent page. */
export const DEFAULT_RECENT_LIMIT = 20
