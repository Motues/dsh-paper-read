/** End-to-end HTTP checks against the harness. */
const base = process.argv[2] ?? 'http://127.0.0.1:4791'
let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

const get = async (path, init) => {
  const response = await fetch(base + path, init)
  const type = response.headers.get('content-type') ?? ''
  const body = type.includes('json') ? await response.json() : await response.text()
  return { status: response.status, body, headers: response.headers }
}

const main = async () => {
  const health = await get('/api/paperreader/health')
  check('health', health.status === 200 && health.body.ok, JSON.stringify(health.body))

  const list = await get('/api/paperreader/papers')
  check('library list', list.status === 200 && list.body.papers.length === 2, `n=${list.body.papers.length}`)
  check('library counts', list.body.counts.all === 2)
  check('cards carry tldr', list.body.papers.every((paper) => typeof paper.tldr === 'string' && paper.tldr.length > 0))
  const paper = list.body.papers[0]

  const detail = await get(`/api/paperreader/papers/${paper.id}`)
  check('paper detail', detail.status === 200 && detail.body.id === paper.id)
  check('paper detail has no conversation history', detail.body.thread === undefined)
  const chatBefore = await get(`/api/paperreader/papers/${paper.id}/chat`)
  const threadBefore = chatBefore.body.messages.length
  check('chat transcript endpoint', chatBefore.status === 200 && Array.isArray(chatBefore.body.messages))
  check('summary attached', Boolean(detail.body.summary?.tldr))
  check('fileUrl', typeof detail.body.fileUrl === 'string' && detail.body.fileUrl.includes('/file'))
  check('annotations empty', Array.isArray(detail.body.annotations) && detail.body.annotations.length === 0)

  const page = await get(`/api/paperreader/papers/${paper.id}/pages/1`)
  check('page text', page.status === 200 && Array.isArray(page.body.blocks) && page.body.blocks.length > 3)
  check('block bbox in points', page.body.blocks.every((block) => block.bbox.length === 4 && block.bbox[2] > 0))
  check('page size in points', page.body.width > 400 && page.body.width < 900)

  const range = await get(`/api/paperreader/papers/${paper.id}/file`, { headers: { range: 'bytes=0-99' } })
  check('pdf range 206', range.status === 206, `status=${range.status}`)
  check('pdf range header', /^bytes 0-99\//.test(range.headers.get('content-range') ?? ''))
  check('pdf magic', String(range.body).startsWith('%PDF'))

  const created = await get(`/api/paperreader/papers/${paper.id}/annotations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      page: 1,
      rects: [[53.6, 506.7, 240, 11.9], [60, 600, 100, 11]],
      quote: '测试高亮的一段文字',
      prefix: '前文',
      suffix: '后文',
      color: 'yellow',
    }),
  })
  check('annotation create', created.status === 201 && created.body.id, JSON.stringify(created.body))
  const annotationId = created.body.id

  const patched = await get(`/api/paperreader/papers/${paper.id}/annotations/${annotationId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ color: 'green' }),
  })
  check('annotation patch', patched.status === 200 && patched.body.color === 'green')

  const listed = await get(`/api/paperreader/papers/${paper.id}/annotations`)
  check('annotation persisted', listed.body.annotations.length === 1 && listed.body.annotations[0].rects.length === 2)

  const withNote = await get(`/api/paperreader/papers/${paper.id}/annotations/${annotationId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: '这条批注笔记讲到多物理场耦合仿真' }),
  })
  check('annotation note saved', withNote.status === 200 && withNote.body.note.includes('多物理场'))

  const noteSearch = await get('/api/paperreader/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '多物理场耦合仿真', rerank: false }),
  })
  check('annotation note is searchable', noteSearch.body.hits.some((hit) => hit.kind === 'note'), JSON.stringify(noteSearch.body.hits).slice(0, 140))

  const note = await get(`/api/paperreader/papers/${paper.id}/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: '这条笔记只讨论偏置漂移的温度补偿', page: 1 }),
  })
  check('note create', note.status === 201)

  const search = await get('/api/paperreader/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '偏置漂移的温度补偿', rerank: false }),
  })
  check('search hits', search.status === 200 && search.body.hits.length > 0, JSON.stringify(search.body).slice(0, 120))
  check('search hit shape', search.body.hits.every((hit) => hit.paperId && hit.page && hit.quote))

  const rel = await get(`/api/paperreader/relations/${paper.id}`)
  check('relations view', rel.status === 200 && Array.isArray(rel.body.edges))

  // ── folders, tags, recent, maintenance ───────────────────────────────────
  const createdFolder = await get('/api/paperreader/folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '精读' }),
  })
  check('folder create', createdFolder.status === 201 && createdFolder.body.id, JSON.stringify(createdFolder.body))
  const folderId = createdFolder.body.id

  const duplicateFolder = await get('/api/paperreader/folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '精读' }),
  })
  check('folder name is unique', duplicateFolder.status === 400)

  const moved = await get(`/api/paperreader/papers/${paper.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ folder: folderId, tags: ['偏置漂移', '综述'], lastRead: { page: 4, scrollTop: 0 } }),
  })
  check('paper moved to folder', moved.status === 200 && moved.body.folder === folderId)
  check('tags updated', Array.isArray(moved.body.tags) && moved.body.tags.length === 2)
  check('lastRead recorded', Boolean(moved.body.lastReadAt))

  const folderList = await get('/api/paperreader/folders')
  check('folder count', folderList.body.folders.find((entry) => entry.id === folderId)?.count === 1)
  check('unfiled count', folderList.body.unfiled === list.body.unfiled - 1)

  const inFolder = await get(`/api/paperreader/papers?folder=${folderId}`)
  check('library filters by folder', inFolder.status === 200 && inFolder.body.papers.length === 1)

  const recentOnly = await get('/api/paperreader/papers?sort=recent')
  check('recent sort returns read papers', recentOnly.body.papers.length === 1 && recentOnly.body.papers[0].id === paper.id)
  check('recent count', recentOnly.body.counts.recent === 1)

  const renamedFolder = await get(`/api/paperreader/folders/${folderId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '必读' }),
  })
  check('folder rename', renamedFolder.status === 200 && renamedFolder.body.name === '必读')

  const reindexed = await get('/api/paperreader/maintenance/reindex', { method: 'POST' })
  check('reindex', reindexed.status === 200 && reindexed.body.chunks > 0, JSON.stringify(reindexed.body))

  const missing = await get('/api/paperreader/maintenance/missing')
  check('missing scan', missing.status === 200 && Array.isArray(missing.body.papers))

  // SSE answer
  const response = await fetch(`${base}/api/paperreader/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paperId: paper.id, kind: 'explain', quote: 'bias drift severely limits long-term stability', page: 1 }),
  })
  check('ask sse status', response.status === 200, `status=${response.status}`)
  const text = await response.text()
  check('ask sse deltas', text.includes('"type":"delta"'), text.slice(0, 80))
  check('ask sse done', text.includes('"type":"done"'))
  const collected = [...text.matchAll(/"text":"([^"]*)"/g)].map((match) => match[1]).join('')
  check('ask answer not empty', collected.length > 10, collected.slice(0, 60))

  const afterExplain = await get(`/api/paperreader/papers/${paper.id}/chat`)
  check('explain enters the conversation', afterExplain.body.messages.length >= threadBefore + 3,
    `n=${afterExplain.body.messages.length}`)
  check('injected context is part of the transcript',
    afterExplain.body.messages.some((message) => message.injected === 'digest' || message.injected === 'retrieval'))
  check('chat payload carries the model route',
    Boolean(afterExplain.body.route?.provider && afterExplain.body.route.model),
    JSON.stringify(afterExplain.body.route))

  const ask = await fetch(`${base}/api/paperreader/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paperId: paper.id, kind: 'ask', question: '这篇论文的主要结论是什么？', page: 2 }),
  })
  await ask.text()
  const afterAsk = await get(`/api/paperreader/papers/${paper.id}/chat`)
  check('ask enters the conversation', afterAsk.body.messages.length > afterExplain.body.messages.length,
    `n=${afterAsk.body.messages.length}`)
  check('last turn is an answer', afterAsk.body.messages.at(-1)?.role === 'assistant')

  const jobs = await get('/api/paperreader/jobs')
  check('jobs list', jobs.status === 200 && jobs.body.jobs.length >= 2)
  check('jobs finished', jobs.body.jobs.every((job) => job.state === 'done'))

  const jobStream = await fetch(`${base}/api/paperreader/jobs/${jobs.body.jobs[0].id}/stream`)
  const jobFrames = await jobStream.text()
  check('job sse sends snapshot', jobFrames.includes('"state":"done"'), jobFrames.slice(0, 80))

  const config = await get('/api/paperreader/config')
  check('config', config.status === 200 && Array.isArray(config.body.watchFolders) && config.body.available === true)
  check('config exposes data dir', typeof config.body.home === 'string' && config.body.home.length > 0)

  const models = await get('/api/paperreader/models')
  check(
    'model catalog',
    models.status === 200
      && models.body.providers.some((provider) => provider.id === 'stub' && provider.models.some((model) => model.id === 'stub-1')),
    JSON.stringify(models.body).slice(0, 160),
  )
  check('default model route exposed', models.body.default?.provider === 'stub')

  const chatModels = await get(`/api/paperreader/papers/${paper.id}/models`)
  check('chat model catalog',
    chatModels.status === 200 && chatModels.body.options.some((option) => option.provider === 'stub'),
    JSON.stringify(chatModels.body).slice(0, 160))
  const chosen = chatModels.body.options.find((option) => option.provider === 'stub')
  const switched = await get(`/api/paperreader/papers/${paper.id}/model`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: chosen.provider, model: chosen.model }),
  })
  check('model switch is recorded', switched.status === 200 && switched.body.model === chosen.model,
    JSON.stringify(switched.body))
  const switchedAgain = await get(`/api/paperreader/papers/${paper.id}/chat`)
  check('the transcript reports the switched model', switchedAgain.body.route?.model === chosen.model,
    JSON.stringify(switchedAgain.body.route))

  const reset = await get(`/api/paperreader/papers/${paper.id}/reset`, { method: 'POST' })
  check('context reset returns a fresh session',
    reset.status === 200 && typeof reset.body.sessionId === 'string'
      && reset.body.sessionId !== reset.body.retired,
    JSON.stringify(reset.body))
  const afterReset = await get(`/api/paperreader/papers/${paper.id}/chat`)
  check('reset empties the transcript',
    afterReset.body.sessionId === reset.body.sessionId && afterReset.body.messages.length === 0,
    `session=${afterReset.body.sessionId} n=${afterReset.body.messages.length}`)
  check('the model choice survives the reset', afterReset.body.route?.model === chosen.model,
    JSON.stringify(afterReset.body.route))

  const pinned = await get('/api/paperreader/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'stub', model: 'stub-1' }),
  })
  check('model route saved', pinned.body.provider === 'stub' && pinned.body.model === 'stub-1')
  const unpinned = await get('/api/paperreader/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: '', model: '' }),
  })
  check('model route can follow default', unpinned.body.provider === '')

  const removed = await get(`/api/paperreader/papers/${paper.id}/annotations/${annotationId}`, { method: 'DELETE' })
  check('annotation delete', removed.status === 200 && removed.body.ok)

  const droppedFolder = await get(`/api/paperreader/folders/${folderId}`, { method: 'DELETE' })
  check('folder delete', droppedFolder.status === 200)
  const afterDrop = await get(`/api/paperreader/papers/${paper.id}`)
  check('papers fall back to unfiled', afterDrop.body.folder === null)

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
