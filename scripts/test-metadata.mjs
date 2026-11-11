/** Offline checks for identifier normalization and citation-meta parsing. */
import { normalizeLink } from '../dist/host/ingest/identifiers.js'
import { metadataFromHtml } from '../dist/host/ingest/link.js'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

const normalized = (input) => {
  try {
    return normalizeLink(input)
  } catch {
    return null
  }
}

check('bare DOI', normalized('10.1038/nature14539')?.kind === 'doi')
check('doi: prefix', normalized('doi: 10.1038/nature14539')?.doi === '10.1038/nature14539')
check('doi.org URL', normalized('https://doi.org/10.1038/nature14539')?.kind === 'doi')
check('DOI with parentheses', normalized('10.1016/S0022-1694(00)00172-6')?.doi === '10.1016/S0022-1694(00)00172-6')

check('arXiv new id', normalized('arXiv:1706.03762')?.arxivId === '1706.03762')
check('arXiv bare id', normalized('1706.03762')?.kind === 'arxiv')
check('arXiv version is dropped', normalized('https://arxiv.org/abs/1706.03762v2')?.arxivId === '1706.03762')
check('arXiv old id', normalized('hep-th/9901001')?.arxivId === 'hep-th/9901001')
check('arXiv pdf URL', normalized('https://arxiv.org/pdf/2405.21060.pdf')?.arxivId === '2405.21060')

check('PMID prefix', normalized('PMID: 26017442')?.pmid === '26017442')
check('bare PMID', normalized('26017442')?.kind === 'pmid')
check('PubMed URL', normalized('https://pubmed.ncbi.nlm.nih.gov/26017442/')?.pmid === '26017442')
check('short numeric input is not a PMID', normalized('2024') === null)

check('publisher URL keeps the DOI', normalized('https://link.springer.com/article/10.1007/s11276-022-03102-w')?.doi === '10.1007/s11276-022-03102-w')
check('DOI inside citation text', normalized('Smith et al. 2020, 10.1234/example')?.kind === 'doi')
check('ordinary URL', normalized('https://example.com/paper')?.kind === 'url')
check('garbage input rejected', normalized('not a paper') === null)

const html = `
<html><head>
  <meta name="citation_title" content="A &amp; B">
  <meta name="citation_author" content="Alice Smith">
  <meta property="citation_author" content="Bob Jones">
  <meta name="citation_journal_title" content="Journal of Tests">
  <meta name="citation_date" content="2024-05-01">
  <meta name="citation_doi" content="10.1234/test.42">
  <meta name="citation_abstract" content="A short abstract.">
  <meta name="citation_reference" content="Reference one">
  <meta name="citation_reference" content="Reference two">
  <meta name="citation_pdf_url" content="/files/paper.pdf">
</head></html>`

const meta = metadataFromHtml(html, normalizeLink('https://example.com/article'))
check('citation title', meta.title === 'A & B', meta.title)
check('citation authors', meta.authors?.length === 2, String(meta.authors?.length))
check('citation year', meta.year === 2024)
check('citation venue', meta.venue === 'Journal of Tests')
check('citation DOI', meta.doi === '10.1234/test.42')
check('citation abstract', meta.abstract === 'A short abstract.')
check('citation references', meta.references?.length === 2)

console.log(failures === 0 ? '\nall metadata checks passed' : `\n${failures} metadata check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
