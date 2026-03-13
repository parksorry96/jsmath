"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";

// --- Types ---

interface GraphNode {
  id: string;
  subject: string;
  unit: string;
  accuracy: number | null;
  totalAttempts: number;
  totalCorrect: number;
  isWeaknessRoot: boolean;
}

interface GraphEdge {
  from: string;
  to: string;
  strength: number;
}

interface Recommendation {
  nodeId: string;
  subject: string;
  unit: string;
  reason: string;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  weaknessRoots: string[];
  recommendations: Recommendation[];
}

interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  column: number;
  row: number;
}

// --- Constants ---

const NODE_RADIUS = 28;
const NODE_SPACING_X = 180;
const NODE_SPACING_Y = 100;
const PADDING = 60;

const SUBJECT_COLORS: Record<string, string> = {
  "수학I": "#6366f1",
  "수학II": "#8b5cf6",
  "미적분": "#ec4899",
  "확률과 통계": "#f59e0b",
  "기하": "#10b981",
};

function getAccuracyColor(accuracy: number | null): string {
  if (accuracy === null) return "#4b5563"; // gray - untested
  if (accuracy >= 70) return "#22c55e"; // green
  if (accuracy >= 40) return "#eab308"; // yellow
  return "#ef4444"; // red
}

function getAccuracyLabel(accuracy: number | null): string {
  if (accuracy === null) return "미응시";
  return `${accuracy}%`;
}

// --- Layout ---

function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { layoutNodes: LayoutNode[]; width: number; height: number } {
  if (nodes.length === 0) {
    return { layoutNodes: [], width: 200, height: 200 };
  }

  // Group nodes by subject
  const subjects = [...new Set(nodes.map((n) => n.subject))];
  const subjectOrder = ["수학I", "수학II", "미적분", "확률과 통계", "기하"];
  subjects.sort(
    (a, b) =>
      (subjectOrder.indexOf(a) === -1 ? 99 : subjectOrder.indexOf(a)) -
      (subjectOrder.indexOf(b) === -1 ? 99 : subjectOrder.indexOf(b)),
  );

  // Topological sort within each subject using Kahn's algorithm
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    if (inDegree.has(edge.to)) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
    if (adj.has(edge.from)) {
      adj.get(edge.from)!.push(edge.to);
    }
  }

  // Assign columns (topological layers) per subject
  const nodeColumn = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
      nodeColumn.set(id, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const col = nodeColumn.get(current) ?? 0;
    for (const next of adj.get(current) ?? []) {
      const existingCol = nodeColumn.get(next) ?? 0;
      nodeColumn.set(next, Math.max(existingCol, col + 1));
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) {
        queue.push(next);
      }
    }
  }

  // Assign rows per subject
  const subjectRowOffset = new Map<string, number>();
  let currentRow = 0;
  for (const subject of subjects) {
    subjectRowOffset.set(subject, currentRow);
    const subjectNodes = nodes.filter((n) => n.subject === subject);
    currentRow += subjectNodes.length + 1; // +1 for spacing between subjects
  }

  const subjectNodeIndex = new Map<string, number>();
  const layoutNodes: LayoutNode[] = nodes.map((node) => {
    const subject = node.subject;
    const idx = subjectNodeIndex.get(subject) ?? 0;
    subjectNodeIndex.set(subject, idx + 1);
    const row = (subjectRowOffset.get(subject) ?? 0) + idx;
    const col = nodeColumn.get(node.id) ?? 0;

    return {
      ...node,
      column: col,
      row,
      x: PADDING + col * NODE_SPACING_X,
      y: PADDING + row * NODE_SPACING_Y,
    };
  });

  const maxCol = Math.max(...layoutNodes.map((n) => n.column), 0);
  const maxRow = Math.max(...layoutNodes.map((n) => n.row), 0);
  const width = PADDING * 2 + maxCol * NODE_SPACING_X + NODE_RADIUS * 2;
  const height = PADDING * 2 + maxRow * NODE_SPACING_Y + NODE_RADIUS * 2;

  return { layoutNodes, width, height };
}

// --- SVG Components ---

function ArrowMarker() {
  return (
    <defs>
      <marker
        id="arrowhead"
        markerWidth="10"
        markerHeight="7"
        refX="10"
        refY="3.5"
        orient="auto"
      >
        <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
      </marker>
      <marker
        id="arrowhead-red"
        markerWidth="10"
        markerHeight="7"
        refX="10"
        refY="3.5"
        orient="auto"
      >
        <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
      </marker>
    </defs>
  );
}

function EdgeLine({
  fromNode,
  toNode,
  strength,
  isWeaknessPath,
}: {
  fromNode: LayoutNode;
  toNode: LayoutNode;
  strength: number;
  isWeaknessPath: boolean;
}) {
  // Calculate edge endpoints on circle boundaries
  const dx = toNode.x - fromNode.x;
  const dy = toNode.y - fromNode.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return null;

  const nx = dx / dist;
  const ny = dy / dist;
  const x1 = fromNode.x + nx * NODE_RADIUS;
  const y1 = fromNode.y + ny * NODE_RADIUS;
  const x2 = toNode.x - nx * (NODE_RADIUS + 12); // extra offset for arrowhead
  const y2 = toNode.y - ny * (NODE_RADIUS + 12);

  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={isWeaknessPath ? "#ef4444" : "#6b7280"}
      strokeWidth={Math.max(1, strength * 2.5)}
      strokeOpacity={isWeaknessPath ? 0.8 : 0.4}
      markerEnd={
        isWeaknessPath ? "url(#arrowhead-red)" : "url(#arrowhead)"
      }
    />
  );
}

function NodeCircle({
  node,
  isSelected,
  onClick,
}: {
  node: LayoutNode;
  isSelected: boolean;
  onClick: () => void;
}) {
  const fillColor = getAccuracyColor(node.accuracy);
  const subjectColor = SUBJECT_COLORS[node.subject] ?? "#6b7280";

  return (
    <g
      onClick={onClick}
      style={{ cursor: "pointer" }}
    >
      {/* Weakness root pulse ring */}
      {node.isWeaknessRoot && (
        <circle
          cx={node.x}
          cy={node.y}
          r={NODE_RADIUS + 6}
          fill="none"
          stroke="#ef4444"
          strokeWidth={2}
          strokeDasharray="4 3"
          opacity={0.6}
        />
      )}

      {/* Selection ring */}
      {isSelected && (
        <circle
          cx={node.x}
          cy={node.y}
          r={NODE_RADIUS + 4}
          fill="none"
          stroke="#fff"
          strokeWidth={2}
        />
      )}

      {/* Subject border ring */}
      <circle
        cx={node.x}
        cy={node.y}
        r={NODE_RADIUS + 1}
        fill={subjectColor}
        opacity={0.6}
      />

      {/* Main circle */}
      <circle
        cx={node.x}
        cy={node.y}
        r={NODE_RADIUS}
        fill={fillColor}
        opacity={0.85}
      />

      {/* Accuracy text */}
      <text
        x={node.x}
        y={node.y - 4}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#fff"
        fontSize={11}
        fontWeight={600}
      >
        {getAccuracyLabel(node.accuracy)}
      </text>

      {/* Unit label */}
      <text
        x={node.x}
        y={node.y + NODE_RADIUS + 14}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#d1d5db"
        fontSize={10}
      >
        {node.unit}
      </text>

      {/* Subject label (smaller) */}
      <text
        x={node.x}
        y={node.y + NODE_RADIUS + 28}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#9ca3af"
        fontSize={8}
      >
        {node.subject}
      </text>
    </g>
  );
}

// --- Detail Panel ---

function NodeDetailPanel({ node }: { node: GraphNode }) {
  const accuracyColor = getAccuracyColor(node.accuracy);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: accuracyColor }}
          />
          <span className="text-sm font-semibold">{node.unit}</span>
          <span className="text-xs text-muted-foreground">({node.subject})</span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold" style={{ color: accuracyColor }}>
              {node.accuracy !== null ? `${node.accuracy}%` : "-"}
            </div>
            <div className="text-xs text-muted-foreground">정답률</div>
          </div>
          <div>
            <div className="text-lg font-bold">{node.totalAttempts}</div>
            <div className="text-xs text-muted-foreground">총 시도</div>
          </div>
          <div>
            <div className="text-lg font-bold">{node.totalCorrect}</div>
            <div className="text-xs text-muted-foreground">정답 수</div>
          </div>
        </div>

        {node.isWeaknessRoot && (
          <div className="rounded-md bg-red-950/30 px-3 py-2 text-xs text-red-400">
            이 단원이 약점의 근본 원인으로 파악되었습니다.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main Component ---

export function KnowledgeGraphViz({ data }: { data: KnowledgeGraphData }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { layoutNodes, width, height } = useMemo(
    () => computeLayout(data.nodes, data.edges),
    [data.nodes, data.edges],
  );

  const nodeMap = useMemo(
    () => new Map(layoutNodes.map((n) => [n.id, n])),
    [layoutNodes],
  );

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;

  // Determine which edges are on weakness paths
  const weaknessEdgeSet = useMemo(() => {
    const set = new Set<string>();
    const rootSet = new Set(data.weaknessRoots);
    const weakSet = new Set(
      data.nodes
        .filter((n) => n.accuracy !== null && n.accuracy < 50)
        .map((n) => n.id),
    );

    // Mark edges that connect weak/root nodes
    for (const edge of data.edges) {
      const fromWeak =
        rootSet.has(edge.from) ||
        weakSet.has(edge.from);
      const toWeak =
        rootSet.has(edge.to) ||
        weakSet.has(edge.to);
      if (fromWeak && toWeak) {
        set.add(`${edge.from}->${edge.to}`);
      }
    }
    return set;
  }, [data]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  // Auto-scroll to center on mount
  useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      container.scrollLeft = Math.max(0, (width - container.clientWidth) / 2);
    }
  }, [width]);

  if (data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        선수과목 데이터가 없습니다. 관리자가 데이터를 시드해야 합니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
          70%+
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-500" />
          40-70%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          {"<40%"}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-600" />
          미응시
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-red-500" />
          약점 근본 원인
        </span>
      </div>

      {/* SVG Graph */}
      <div
        ref={containerRef}
        className="overflow-auto rounded-xl border border-border bg-brand-darker"
      >
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <ArrowMarker />

          {/* Edges */}
          {data.edges.map((edge) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (!fromNode || !toNode) return null;
            const isWeakness = weaknessEdgeSet.has(
              `${edge.from}->${edge.to}`,
            );
            return (
              <EdgeLine
                key={`${edge.from}->${edge.to}`}
                fromNode={fromNode}
                toNode={toNode}
                strength={edge.strength}
                isWeaknessPath={isWeakness}
              />
            );
          })}

          {/* Nodes */}
          {layoutNodes.map((node) => (
            <NodeCircle
              key={node.id}
              node={node}
              isSelected={selectedNodeId === node.id}
              onClick={() => handleNodeClick(node.id)}
            />
          ))}
        </svg>
      </div>

      {/* Detail panel */}
      {selectedNode && <NodeDetailPanel node={selectedNode} />}
    </div>
  );
}
