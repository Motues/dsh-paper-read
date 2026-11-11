/**
 * The force-directed graph.
 *
 * d3-force owns the physics; React renders the elements once and the tick
 * handler writes `transform`/line coordinates straight into refs, so hovering or
 * dragging never re-renders a few hundred nodes. Colours and dimming are CSS
 * driven (data attributes), which keeps the theme tokens in charge.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { EdgeKind, RelationCluster, RelationGraphEdge, RelationGraphNode } from '../../types.js'
import { KIND_META, clusterColor } from './palette.js'
import { IconChevronDown, IconFit, IconMinus, IconPlus } from '../../components/ui.js'

interface SimNode extends SimulationNodeDatum {
  id: string
  title: string
  year?: number
  r: number
  cluster: string
  degree: number
  weight: number
  isolated: boolean
  missing?: boolean
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string
  kind: EdgeKind
  status: string
  confidence: number
}

export interface GraphCanvasProps {
  nodes: RelationGraphNode[]
  edges: RelationGraphEdge[]
  clusters: RelationCluster[]
  selectedId: string | null
  hiddenNodes: Set<string>
  hiddenEdges: Set<string>
  dimNodes: Set<string>
  dimEdges: Set<string>
  onSelect: (id: string | null) => void
  onOpen: (id: string) => void
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

function hash(text: string): number {
  let value = 0
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) >>> 0
  return value
}

function radiusFor(weight: number): number {
  return clamp(6.5 + Math.sqrt(Math.max(0, weight)) * 4.2, 6.5, 19)
}

export function GraphCanvas({
  nodes,
  edges,
  clusters,
  selectedId,
  hiddenNodes,
  hiddenEdges,
  dimNodes,
  dimEdges,
  onSelect,
  onOpen,
}: GraphCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const nodeEls = useRef(new Map<string, SVGGElement>())
  const edgeEls = useRef(new Map<string, SVGLineElement>())
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  /** Repaints node/edge coordinates after a manual drag. */
  const redrawRef = useRef<() => void>(() => {})
  const viewRef = useRef({ k: 1, x: 0, y: 0 })
  const sizeRef = useRef({ width: 0, height: 0 })
  const dragRef = useRef<{
    id: string
    moved: boolean
    pointerId: number
    startX: number
    startY: number
    /** Pointer offset from the node centre, so a grab never snaps the node. */
    grabX: number
    grabY: number
  } | null>(null)
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  /** Swallows the click that follows a drag release, so it cannot clear selection. */
  const skipClickRef = useRef(false)
  const tipElement = useRef<HTMLDivElement>(null)
  const tipPosition = useRef({ x: 0, y: 0 })
  const [view, setView] = useState(viewRef.current)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [tooltip, setTooltip] = useState<{ id: string } | null>(null)
  /** Cluster colour is the default; year answers "what is old here" instead. */
  const [colorBy, setColorBy] = useState<'cluster' | 'year'>('cluster')

  const yearSpan = useMemo(() => {
    const years = nodes.map((node) => node.year).filter((year): year is number => typeof year === 'number')
    if (years.length === 0) return null
    return { min: Math.min(...years), max: Math.max(...years) }
  }, [nodes])

  const yearBand = useCallback((year?: number): number => {
    if (!yearSpan || year === undefined) return 2
    const span = yearSpan.max - yearSpan.min
    if (span <= 0) return 2
    return Math.max(0, Math.min(4, Math.floor(((year - yearSpan.min) / (span + 1)) * 5)))
  }, [yearSpan])

  const fillOf = useCallback((node: RelationGraphNode, clusterFill: string): string => (
    colorBy === 'year' ? `var(--pr-y${yearBand(node.year) + 1})` : clusterFill
  ), [colorBy, yearBand])

  const clusterMap = useMemo(() => new Map(clusters.map((cluster) => [cluster.id, cluster])), [clusters])
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of edges) {
      if (hiddenEdges.has(edge.id)) continue
      const from = map.get(edge.from) ?? new Set<string>()
      from.add(edge.to)
      map.set(edge.from, from)
      const to = map.get(edge.to) ?? new Set<string>()
      to.add(edge.from)
      map.set(edge.to, to)
    }
    return map
  }, [edges, hiddenEdges])

  const neighbours = useMemo(
    () => (selectedId ? adjacency.get(selectedId) ?? new Set<string>() : null),
    [adjacency, selectedId],
  )

  const path = useMemo(() => {
    if (!selectedId || !hoverId || selectedId === hoverId) return null
    const previous = new Map<string, string>()
    const queue = [selectedId]
    const seen = new Set([selectedId])
    while (queue.length > 0) {
      const current = queue.shift() as string
      if (current === hoverId) break
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        previous.set(next, current)
        queue.push(next)
      }
    }
    if (!seen.has(hoverId)) return null
    const nodePath = new Set<string>([hoverId])
    const edgePath = new Set<string>()
    let cursor = hoverId
    while (cursor !== selectedId) {
      const parent = previous.get(cursor)
      if (!parent) break
      nodePath.add(parent)
      const edge = edges.find((item) => (
        (item.from === parent && item.to === cursor) || (item.from === cursor && item.to === parent)
      ))
      if (edge) edgePath.add(edge.id)
      cursor = parent
    }
    const titleOf = new Map(nodes.map((node) => [node.id, node.title]))
    return {
      nodes: nodePath,
      edges: edgePath,
      hops: nodePath.size - 1,
      from: titleOf.get(selectedId) ?? selectedId,
      to: titleOf.get(hoverId) ?? hoverId,
    }
  }, [adjacency, edges, hoverId, nodes, selectedId])

  const applyView = useCallback((next: { k: number; x: number; y: number }) => {
    viewRef.current = next
    setView(next)
  }, [])

  const fit = useCallback(() => {
    const { width, height } = sizeRef.current
    const canvasWidth = width || wrapRef.current?.clientWidth || 720
    const canvasHeight = height || wrapRef.current?.clientHeight || 520
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of nodesRef.current) {
      const x = node.x ?? 0
      const y = node.y ?? 0
      minX = Math.min(minX, x - node.r)
      minY = Math.min(minY, y - node.r)
      maxX = Math.max(maxX, x + node.r)
      maxY = Math.max(maxY, y + node.r)
    }
    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return
    const padding = 78
    const k = clamp(
      Math.min((canvasWidth - padding * 2) / (maxX - minX), (canvasHeight - padding * 2) / (maxY - minY)),
      0.35,
      1.15,
    )
    applyView({
      k,
      x: canvasWidth / 2 - ((minX + maxX) / 2) * k,
      y: canvasHeight / 2 - ((minY + maxY) / 2) * k,
    })
  }, [applyView])

  const zoomBy = useCallback((factor: number, centerX?: number, centerY?: number) => {
    const { width, height } = sizeRef.current
    const px = centerX ?? (width || 720) / 2
    const py = centerY ?? (height || 520) / 2
    const current = viewRef.current
    const k = clamp(current.k * factor, 0.35, 3)
    applyView({ k, x: px - ((px - current.x) * k) / current.k, y: py - ((py - current.y) * k) / current.k })
  }, [applyView])

  // ── simulation lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    if (nodes.length === 0) return
    const width = wrapRef.current?.clientWidth || sizeRef.current.width || 720
    const height = wrapRef.current?.clientHeight || sizeRef.current.height || 520
    if (width > 0 && height > 0) sizeRef.current = { width, height }
    const simNodes: SimNode[] = nodes.map((node, index) => {
      const angle = (hash(node.id) % 360) * (Math.PI / 180) + index * 0.7
      const spread = Math.max(90, Math.min(width, height) * 0.34)
      const radius = spread * (0.45 + (hash(`${node.id}:r`) % 100) / 160)
      return {
        id: node.id,
        title: node.title,
        year: node.year,
        r: radiusFor(node.weight),
        cluster: node.cluster,
        degree: node.degree,
        weight: node.weight,
        isolated: node.isolated,
        missing: node.missing,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
      }
    })
    const simLinks: SimLink[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      kind: edge.kind,
      status: edge.status,
      confidence: edge.confidence,
    }))
    nodesRef.current = simNodes

    const linkBase = clamp(Math.sqrt((width * height) / Math.max(6, simNodes.length)) * 0.62, 90, 220)
    const simulation = forceSimulation<SimNode, SimLink>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance((link) => linkBase + 34 - 26 * link.confidence)
        .strength((link) => 0.18 + 0.4 * link.confidence))
      .force('charge', forceManyBody<SimNode>().strength(-Math.max(620, Math.min(3200, simNodes.length * 120))).distanceMax(1400))
      .force('collide', forceCollide<SimNode>().radius((node) => node.r + 12).iterations(2))
      .force('center', forceCenter(width / 2, height / 2))
      .force('x', forceX(width / 2).strength(0.018))
      .force('y', forceY(height / 2).strength(0.022))
      .alphaDecay(0.022)
      .velocityDecay(0.34)

    const tick = (): void => {      for (const node of simNodes) {
        const element = nodeEls.current.get(node.id)
        if (element) element.setAttribute('transform', `translate(${(node.x ?? 0).toFixed(2)},${(node.y ?? 0).toFixed(2)})`)
      }
      for (const link of simLinks) {
        const element = edgeEls.current.get(link.id)
        if (!element) continue
        const source = link.source as SimNode
        const target = link.target as SimNode
        element.setAttribute('x1', String(source.x ?? 0))
        element.setAttribute('y1', String(source.y ?? 0))
        element.setAttribute('x2', String(target.x ?? 0))
        element.setAttribute('y2', String(target.y ?? 0))
      }
    }

    // Settle synchronously so the page opens on a readable layout instead of a
    // second of nodes flying into place. Pack disconnected components (a lone
    // paper, a two-paper sub-topic) into a bottom strip so they cannot shrink
    // the main cluster — otherwise one orphan forces the whole graph down to a
    // thumbnail.
    simulation.stop()
    for (let step = 0; step < 300; step += 1) simulation.tick()

    const parent = new Map<string, string>()
    const find = (id: string): string => {
      let root = id
      while (parent.get(root) && parent.get(root) !== root) root = parent.get(root) as string
      return root
    }
    const union = (left: string, right: string): void => {
      const a = find(left)
      const b = find(right)
      if (a !== b) parent.set(a, b)
    }
    for (const node of simNodes) parent.set(node.id, node.id)
    for (const link of simLinks) {
      const source = typeof link.source === 'object' ? (link.source as SimNode).id : String(link.source)
      const target = typeof link.target === 'object' ? (link.target as SimNode).id : String(link.target)
      union(source, target)
    }
    const groups = new Map<string, SimNode[]>()
    for (const node of simNodes) {
      const root = find(node.id)
      const list = groups.get(root) ?? []
      list.push(node)
      groups.set(root, list)
    }
    const components = [...groups.values()].sort((left, right) => right.length - left.length)
    const bboxOf = (group: SimNode[]) => {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of group) {
        minX = Math.min(minX, (node.x ?? 0) - node.r)
        minY = Math.min(minY, (node.y ?? 0) - node.r)
        maxX = Math.max(maxX, (node.x ?? 0) + node.r)
        maxY = Math.max(maxY, (node.y ?? 0) + node.r)
      }
      return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
    }
    const place = (group: SimNode[], box: { x: number; y: number; w: number; h: number }, maxScale: number): void => {
      const bounds = bboxOf(group)
      const scale = clamp(Math.min(box.w / bounds.w, box.h / bounds.h), 0.35, maxScale)
      const centerX = bounds.x + bounds.w / 2
      const centerY = bounds.y + bounds.h / 2
      const targetX = box.x + box.w / 2
      const targetY = box.y + box.h / 2
      for (const node of group) {
        node.x = targetX + ((node.x ?? 0) - centerX) * scale
        node.y = targetY + ((node.y ?? 0) - centerY) * scale
        node.vx = 0
        node.vy = 0
      }
    }
    const pad = 24
    // No relations at all: a grid reads better than a lone hub with a pod strip.
    if (components[0].length <= 1) {
      const count = Math.max(1, simNodes.length)
      const columns = Math.max(3, Math.min(8, Math.round(Math.sqrt((count * width) / Math.max(1, height)))))
      const rows = Math.max(1, Math.ceil(count / columns))
      const cellWidth = (width - pad * 2) / columns
      const cellHeight = (height - pad * 2) / rows
      simNodes.forEach((node, index) => {
        node.x = pad + (index % columns + 0.5) * cellWidth
        node.y = pad + (Math.floor(index / columns) + 0.5) * cellHeight
        node.vx = 0
        node.vy = 0
      })
    } else {
      const pods = components.slice(1)
      const podRows = pods.length > 6 ? 2 : 1
      const podArea = pods.length > 0 ? podRows * 66 + 18 : 0
      const mainBox = { x: pad, y: pad, w: width - pad * 2, h: height - podArea - pad }
      if (components[0]) place(components[0], mainBox, 2.6)
      if (pods.length > 0) {
        const perRow = Math.ceil(pods.length / podRows)
        const cellWidth = (width - pad * 2) / perRow
        pods.forEach((group, index) => {
          const row = Math.floor(index / perRow)
          const column = index % perRow
          place(
            group,
            { x: pad + column * cellWidth, y: height - podArea + row * 66, w: cellWidth - 18, h: 52 },
            1.3,
          )
        })
      }
    }
    // The packed layout is the final layout: the simulation stays stopped and
    // is never reheated. Restarting it used to let the charge force (no longer
    // balanced by centring) push nodes apart, so every click inflated the graph
    // a little more; dragging now moves the node itself, not the physics.
    simulation.on('tick', tick)
    redrawRef.current = tick
    tick()
    fit()
    simRef.current = simulation
    simulation.stop()

    const timer = window.setTimeout(() => fit(), 400)
    return () => {
      window.clearTimeout(timer)
      simulation.stop()
      simRef.current = null
      redrawRef.current = () => {}
    }
  }, [nodes, edges, fit])

  useEffect(() => {
    if (!wrapRef.current) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      if (width === 0 || height === 0) return
      const first = sizeRef.current.width === 0 || sizeRef.current.height === 0
      sizeRef.current = { width, height }
      // The initial measurement arrives after the layout was packed with a
      // fallback size; re-pack once so the graph fills the real canvas.
      if (first) {
        const simulation = simRef.current
        if (!simulation) return
        window.setTimeout(() => fit(), 40)
        return
      }
      window.setTimeout(() => fit(), 80)
    })
    observer.observe(wrapRef.current)
    return () => observer.disconnect()
  }, [fit])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = svg.getBoundingClientRect()
      zoomBy(Math.exp(-event.deltaY * 0.0016), event.clientX - rect.left, event.clientY - rect.top)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  // Tooltip follows the pointer without re-rendering the node list.
  useLayoutEffect(() => {
    const element = tipElement.current
    if (!element) return
    element.style.transform = `translate(${tipPosition.current.x}px, ${tipPosition.current.y}px)`
  }, [tooltip])

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const current = viewRef.current
    return { x: (clientX - rect.left - current.x) / current.k, y: (clientY - rect.top - current.y) / current.k }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const target = event.target as Element
    const nodeElement = target.closest('[data-node-id]') as SVGGElement | null
    if (nodeElement) {
      const id = nodeElement.getAttribute('data-node-id') as string
      const node = nodesRef.current.find((item) => item.id === id)
      if (!node) return
      const point = localPoint(event.clientX, event.clientY)
      // Do not capture the pointer here: capturing retargets the following
      // click to the <svg>, which made every node click look like a background
      // click (select, then immediately clear). Capture starts with the drag.
      dragRef.current = {
        id,
        moved: false,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        grabX: point.x - (node.x ?? 0),
        grabY: point.y - (node.y ?? 0),
      }
      return
    }
    svgRef.current?.setPointerCapture(event.pointerId)
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    if (drag) {
      if (!drag.moved) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 3) return
        drag.moved = true
        svgRef.current?.setPointerCapture(event.pointerId)
      }
      const node = nodesRef.current.find((item) => item.id === drag.id)
      if (!node) return
      const point = localPoint(event.clientX, event.clientY)
      node.x = point.x - drag.grabX
      node.y = point.y - drag.grabY
      redrawRef.current()
      return
    }
    const pan = panRef.current
    if (pan) {
      applyView({
        k: viewRef.current.k,
        x: pan.originX + event.clientX - pan.startX,
        y: pan.originY + event.clientY - pan.startY,
      })
    }
  }

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    if (drag) {
      dragRef.current = null
      if (drag.moved) {
        // The browser still synthesises a click after the release; without
        // this guard the background handler would clear the new selection.
        skipClickRef.current = true
        window.setTimeout(() => { skipClickRef.current = false }, 300)
        // The node simply stays where it was dropped: the simulation is not
        // restarted, so the rest of the packed layout cannot drift.
      } else {
        onSelect(drag.id)
      }
    }
    panRef.current = null
    try {
      svgRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      /* pointer already released */
    }
  }

  const showTooltip = (id: string, clientX: number, clientY: number): void => {
    const wrap = wrapRef.current
    if (wrap) {
      const rect = wrap.getBoundingClientRect()
      const x = Math.min(clientX - rect.left + 14, rect.width - 250)
      const y = Math.min(clientY - rect.top + 12, rect.height - 136)
      tipPosition.current = { x: Math.max(6, x), y: Math.max(6, y) }
    }
    setHoverId(id)
    setTooltip({ id })
  }

  const activeHover = tooltip ? nodes.find((node) => node.id === tooltip.id) ?? null : null
  const hoverCluster = activeHover ? clusterMap.get(activeHover.cluster) : null

  return (
    <div className="pr-graph-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="pr-graph-svg"
        role="img"
        aria-label="论文关系图"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          setHoverId(null)
          setTooltip(null)
        }}
        onClick={(event) => {
          if (skipClickRef.current) {
            skipClickRef.current = false
            return
          }
          if ((event.target as Element).closest('[data-node-id]')) return
          onSelect(null)
        }}
      >
        <defs>
          <marker id="pr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--pr-line-strong)" />
          </marker>
          <marker id="pr-arrow-strong" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--pr-accent)" />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <g className="pr-gedges">
            {edges.map((edge) => {
              const meta = KIND_META[edge.kind]
              const isPath = path?.edges.has(edge.id) ?? false
              const isNear = selectedId !== null && (selectedId === edge.from || selectedId === edge.to)
              // Focusing a paper dims the unrelated wires too; the selection
              // itself is carried by the label, halo and one-hop highlight.
              const isDim = (dimEdges.has(edge.id) && !isPath) || (selectedId !== null && !isNear && !isPath)
              return (
                <line
                  key={edge.id}
                  ref={(element) => {
                    if (element) edgeEls.current.set(edge.id, element)
                    else edgeEls.current.delete(edge.id)
                  }}
                  className="pr-gedge"
                  data-kind={edge.kind}
                  data-status={edge.status}
                  data-path={isPath || undefined}
                  data-near={isNear || undefined}
                  data-hidden={hiddenEdges.has(edge.id) || undefined}
                  data-dim={isDim || undefined}
                  stroke={meta.color}
                  markerEnd={meta.directed ? (isPath ? 'url(#pr-arrow-strong)' : 'url(#pr-arrow)') : undefined}
                >
                  <title>{`${meta.label} · ${edge.reason}`}</title>
                </line>
              )
            })}
          </g>
          <g className="pr-gnodes">
            {nodes.map((node, index) => {
              const cluster = clusterMap.get(node.cluster)
              const nodeRadius = radiusFor(node.weight)
              const isSelected = selectedId === node.id
              const isHover = hoverId === node.id
              const isPath = path?.nodes.has(node.id) ?? false
              const isNear = selectedId !== null && (isSelected || (neighbours?.has(node.id) ?? false))
              const isDim = (dimNodes.has(node.id) && !isPath && !isSelected)
                || (selectedId !== null && !isSelected && !(neighbours?.has(node.id) ?? false) && !isPath)
              const showLabel = showLabels && (nodes.length <= 30 || node.degree >= 2 || isSelected || isHover || isNear)
              return (
                <g
                  key={node.id}
                  ref={(element) => {
                    if (element) nodeEls.current.set(node.id, element)
                    else nodeEls.current.delete(node.id)
                  }}
                  className="pr-gnode"
                  data-node-id={node.id}
                  data-selected={isSelected || undefined}
                  data-hover={isHover || undefined}
                  data-near={isNear || undefined}
                  data-path={isPath || undefined}
                  data-dim={isDim || undefined}
                  data-hidden={hiddenNodes.has(node.id) || undefined}
                  data-isolated={node.isolated || undefined}
                  data-missing={node.missing || undefined}
                  style={{ animationDelay: `${Math.min(index * 12, 260)}ms` }}
                  onPointerEnter={(event) => showTooltip(node.id, event.clientX, event.clientY)}
                  onPointerLeave={() => {
                    setHoverId(null)
                    setTooltip(null)
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    onOpen(node.id)
                  }}
                >
                  <circle
                    className="pr-gnode-halo"
                    r={nodeRadius + 8}
                    fill={fillOf(node, clusterColor(cluster?.color ?? -1))}
                  />
                  <circle
                    className="pr-gnode-core"
                    r={nodeRadius}
                    fill={node.missing ? 'transparent' : fillOf(node, clusterColor(cluster?.color ?? -1))}
                  />
                  {node.missing ? <circle className="pr-gnode-dashed" r={nodeRadius} /> : null}
                  {node.duplicateOf ? <circle className="pr-gnode-dup" r={nodeRadius + 3} /> : null}
                  {showLabel ? (
                    <text className="pr-gnode-label" y={nodeRadius + 14} textAnchor="middle">
                      {node.title.length > 22 ? `${node.title.slice(0, 22)}…` : node.title}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      <div className="pr-graph-hud">
        <button type="button" className="pr-hud-btn" title="放大" onClick={() => zoomBy(1.25)}><IconPlus size={13} /></button>
        <button type="button" className="pr-hud-btn" title="缩小" onClick={() => zoomBy(0.8)}><IconMinus size={13} /></button>
        <button type="button" className="pr-hud-btn" title="适应画布" onClick={() => { fit(); setTooltip(null) }}><IconFit size={13} /></button>
        <button type="button" className="pr-hud-btn" data-on={showLabels || undefined} title="显示 / 隐藏标题" onClick={() => setShowLabels((value) => !value)}>
          <span className="pr-hud-label">Aa</span>
        </button>
        <button
          type="button"
          className="pr-hud-btn"
          data-on={colorBy === 'year' || undefined}
          disabled={!yearSpan}
          title={colorBy === 'year' ? '按主题着色' : '按年份着色（越深越新）'}
          onClick={() => setColorBy((value) => (value === 'year' ? 'cluster' : 'year'))}
        >
          <span className="pr-hud-label">年</span>
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="pr-graph-empty">
          <b>还没有论文</b>
          <span>导入 PDF 或粘贴 DOI / arXiv 之后，这里会按引用与语义自动长出关系图。</span>
        </div>
      ) : null}

      {path ? (
        <div className="pr-graph-path">
          <b>{path.hops}</b> 跳 · {path.from} → {path.to}
        </div>
      ) : null}

      {colorBy === 'year' && yearSpan ? (
        <div className="pr-year-legend" aria-hidden="true">
          <span>{yearSpan.min}</span>
          <i />
          <span>{yearSpan.max}</span>
        </div>
      ) : null}

      <div className="pr-graph-legend" aria-hidden="true">
        <span><i style={{ background: 'var(--pr-k-cites)' }} />引用</span>
        <span><i style={{ background: 'var(--pr-k-builds)' }} />基于</span>
        <span><i style={{ background: 'var(--pr-k-method)' }} />同方法</span>
        <span><i style={{ background: 'var(--pr-k-problem)' }} />同问题</span>
        <span><i style={{ background: 'var(--pr-k-uses)' }} />应用</span>
        <span><i style={{ background: 'var(--pr-k-contra)' }} />相反</span>
      </div>

      {activeHover ? (
        <div className="pr-graph-tip" ref={tipElement} role="tooltip">
          <b>{activeHover.title}</b>
          <span className="pr-graph-tip-meta">
            {[activeHover.year, activeHover.venue, `${activeHover.degree} 条关联`, hoverCluster?.label]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {activeHover.tags.length > 0 ? (
            <span className="pr-graph-tip-tags">{activeHover.tags.map((tag) => `#${tag}`).join(' ')}</span>
          ) : null}
          <span className="pr-graph-tip-hint">
            <IconChevronDown size={11} /> 单击聚焦 · 双击打开
          </span>
        </div>
      ) : null}
    </div>
  )
}
