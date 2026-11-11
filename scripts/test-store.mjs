/**
 * Annotation durability checks: concurrent writes must not clobber each other,
 * a fresh Store (a DSH restart) must see the same highlights, and a truncated
 * annotations.json must fall back to its mirrored `.bak` instead of looking
 * like "this paper has no annotations".
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../dist/host/library/store.js'
import { createLibraryQueries } from '../dist/host/library/queries.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-store-'))
try {
  const store = new Store(home)
  await store.load()

  const input = { page: 1, rects: [[10, 20, 30, 18]], quote: 'persist me', color: 'yellow' }
  const first = await store.addAnnotation('p1', input)
  const second = await store.addAnnotation('p1', { ...input, quote: 'second' })
  assert.equal((await store.readAnnotations('p1')).length, 2)

  const file = path.join(home, 'paperreader', 'papers', 'p1', 'annotations.json')
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).length, 2)
  assert.equal(JSON.parse(await fs.readFile(`${file}.bak`, 'utf8')).length, 2)

  // A truncated main file falls back to the mirrored snapshot.
  await fs.writeFile(file, '[{"bad"', 'utf8')
  const recovered = await store.readAnnotations('p1')
  assert.equal(recovered.length, 2)
  assert.equal(recovered[1].id, second.id)

  // A new Store is what a DSH restart does.
  const restarted = new Store(home)
  await restarted.load()
  const afterRestart = await restarted.readAnnotations('p1')
  assert.equal(afterRestart.length, 2)
  assert.equal(afterRestart[0].quote, 'persist me')

  // Deleting the last annotation must stay deleted, not resurrect `.bak`.
  await restarted.removeAnnotation('p1', first.id)
  await restarted.removeAnnotation('p1', second.id)
  const empty = await new Store(home).load()
  assert.deepEqual(await empty.readAnnotations('p1'), [])

  // Twelve overlapping requests all survive because writes are serialized.
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.addAnnotation('p2', {
    page: 1,
    rects: [[index, index, 10, 10]],
    quote: `q${index}`,
    color: 'yellow',
  })))
  assert.equal((await store.readAnnotations('p2')).length, 12)

  // ── nested folders ───────────────────────────────────────────────────────
  const root = await store.addFolder('Root')
  const child = await store.addFolder('Child', root.id)
  assert.equal(child.parentId, root.id)
  await assert.rejects(() => store.addFolder('child', root.id), /同名/)
  const other = await store.addFolder('Other')
  const namesake = await store.addFolder('Child', other.id)
  assert.equal(namesake.parentId, other.id)

  const record = (id, folder) => ({
    id,
    title: id,
    authors: [],
    tags: [],
    folder,
    status: 'todo',
    progress: 0,
    source: 'pdf',
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasFullText: false,
    hasSummary: false,
  })
  await store.addPaper(record('p_nested', child.id))
  assert.deepEqual(store.folderSubtree(root.id).sort(), [root.id, child.id].sort())
  const removedFolders = await store.removeFolder(root.id)
  assert.equal(removedFolders.length, 2)
  assert.equal(store.getFolder(child.id), undefined)
  assert.equal(store.getPaper('p_nested').folder, null)

  // ── recycle bin: soft delete keeps data, restore brings it back ──────────
  await store.addPaper(record('p_trash', null))
  await store.trashPaper('p_trash')
  assert.equal(store.activePapers().some((entry) => entry.id === 'p_trash'), false)
  assert.equal(store.trashedPapers().length, 1)
  const restartedStore = await new Store(home).load()
  assert.ok(restartedStore.getPaper('p_trash')?.deletedAt)
  await restartedStore.restorePaper('p_trash')
  assert.equal(restartedStore.trashedPapers().length, 0)
  assert.equal(restartedStore.activePapers().some((entry) => entry.id === 'p_trash'), true)

  // Purge and empty remove the record and its per-paper directory.
  await restartedStore.trashPaper('p_nested')
  const queries = createLibraryQueries(restartedStore)
  assert.equal(queries.folderView().trash, 1)
  assert.equal(queries.listPapers().some((entry) => entry.id === 'p_nested'), false)
  assert.equal(queries.listPapers({ status: 'all' }).length, 1)
  await restartedStore.trashPaper('p_trash')
  const purged = await restartedStore.emptyTrash()
  assert.deepEqual(purged.sort(), ['p_nested', 'p_trash'])
  assert.equal(restartedStore.getPaper('p_trash'), undefined)

  console.log('all annotation persistence checks passed')
} finally {
  await fs.rm(home, { recursive: true, force: true })
}
