/**
 * The single injected stylesheet, assembled from feature modules.
 *
 * DSH theme tokens come first. Every module starts with a newline for
 * readability; the first one supplies the leading newline the old single
 * template had, and the rest are joined without duplicating it.
 */
import { tokens } from './tokens.js'
import { shell } from './shell.js'
import { reader } from './reader.js'
import { chat } from './chat.js'
import { panels } from './panels.js'
import { document } from './document.js'
import { translation } from './translation.js'
import { queue } from './queue.js'
import { library } from './library.js'
import { settingsBase } from './settingsBase.js'
import { controls } from './controls.js'
import { relations } from './relations.js'
import { librarySidebar } from './librarySidebar.js'
import { settings } from './settings.js'
import { usage } from './usage.js'
import { tasks } from './tasks.js'

const PARTS = [
  tokens,
  shell,
  reader,
  chat,
  panels,
  document,
  translation,
  queue,
  library,
  settingsBase,
  controls,
  relations,
  librarySidebar,
  settings,
  usage,
  tasks,
]

export const STYLES = PARTS.map((part, index) => (index === 0 ? part : part.slice(1))).join('')
