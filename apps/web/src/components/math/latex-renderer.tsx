"use client";

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface LatexRendererProps {
  /** Text containing mixed Korean/English text and LaTeX delimiters ($...$ or $$...$$) */
  content: string;
  className?: string;
}

interface Segment {
  type: "text" | "inline-math" | "block-math" | "image";
  value: string;
  alt?: string;
}

/**
 * Strip LaTeX commands that shouldn't render in the UI:
 * \section*{...}, \footnotetext{...}, etc.
 */
function cleanLatexCommands(input: string): string {
  return (
    input
      // \section*{...} or \section{...}
      .replace(/\\section\*?\{[^}]*\}/g, "")
      // \footnotetext{ ... } — may span multiple lines
      .replace(/\\footnotetext\s*\{[\s\S]*?\n\}/g, "")
      // Trim leftover blank lines (3+ newlines → 2)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Convert \begin{tabular} to \begin{array} for KaTeX compatibility,
 * then wrap only truly bare tabular blocks (those outside $$) in $$.
 */
function wrapBareEnvironments(input: string): string {
  // Convert tabular → array (KaTeX doesn't support tabular)
  let result = input
    .replace(/\\begin\{tabular\}/g, "\\begin{array}")
    .replace(/\\end\{tabular\}/g, "\\end{array}");

  // Only wrap \begin{array}...\end{array} that appear OUTSIDE $$...$$ blocks.
  // Strategy: split on $$, wrap only in non-math segments.
  const parts = result.split(/(\$\$[\s\S]*?\$\$)/g);
  return parts
    .map((part) => {
      // If this part is a $$...$$ block, leave it as-is
      if (part.startsWith("$$") && part.endsWith("$$")) return part;
      // Otherwise, wrap bare \begin{array}...\end{array}
      return part.replace(
        /(\\begin\{array\}[\s\S]*?\\end\{array\})/g,
        (m) => {
          // Strip inner $...$ delimiters: tabular uses $ for inline math,
          // but array is already math-mode so inner $ causes KaTeX errors.
          // Add spaces around content to prevent merging (e.g. \hline$z$ → \hline z)
          const stripped = m.replace(/\$([^$]+?)\$/g, " $1 ");
          return `$$${stripped}$$`;
        },
      );
    })
    .join("");
}


/**
 * Parse content string into segments of plain text, inline math ($...$),
 * block math ($$...$$), and images (![alt](url)).
 */
function parseLatex(input: string): Segment[] {
  const cleaned = wrapBareEnvironments(cleanLatexCommands(input));
  const segments: Segment[] = [];

  // Replace escaped dollars with a placeholder to avoid false matches
  const ESCAPED_DOLLAR = "\x00ESCAPED_DOLLAR\x00";
  const processed = cleaned.replace(/\\\$/g, ESCAPED_DOLLAR);

  // Combined pattern: images, block math, inline math
  // 1. ![alt](url)
  // 2. $$...$$ block math
  // 3. $...$ inline math
  const pattern =
    /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)|\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(processed)) !== null) {
    // Add preceding text segment
    if (match.index > lastIndex) {
      const text = processed
        .slice(lastIndex, match.index)
        .replaceAll(ESCAPED_DOLLAR, "$");
      if (text.trim()) {
        segments.push({ type: "text", value: text });
      }
    }

    if (match[2] !== undefined) {
      // Image: ![alt](url)
      segments.push({ type: "image", value: match[2], alt: match[1] || "" });
    } else if (match[3] !== undefined) {
      // Block math ($$...$$)
      segments.push({ type: "block-math", value: match[3].trim() });
    } else if (match[4] !== undefined) {
      // Inline math ($...$)
      segments.push({ type: "inline-math", value: match[4].trim() });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < processed.length) {
    const text = processed.slice(lastIndex).replaceAll(ESCAPED_DOLLAR, "$");
    if (text.trim()) {
      segments.push({ type: "text", value: text });
    }
  }

  return segments;
}

/**
 * Force subscripts below operators like \lim, \sum, \prod, etc.
 * In inline mode KaTeX places them to the right by default.
 */
function addLimits(latex: string): string {
  if (latex.includes("\\limits")) return latex;
  return latex.replace(
    /\\(lim|sum|prod|max|min|sup|inf|bigcup|bigcap)\s*_/g,
    "\\$1\\limits_",
  );
}

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    const processed = displayMode ? latex : addLimits(latex);
    return katex.renderToString(processed, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: true,
    });
  } catch {
    // Fallback: show raw LaTeX in a styled span
    return `<code class="text-red-400">${latex}</code>`;
  }
}

export function LatexRenderer({ content, className }: LatexRendererProps) {
  const rendered = useMemo(() => {
    if (!content) return [];
    return parseLatex(content);
  }, [content]);

  if (!content) {
    return (
      <span className="text-muted-foreground italic">
        (No content)
      </span>
    );
  }

  return (
    <div className={className}>
      {rendered.map((segment, i) => {
        if (segment.type === "image") {
          return (
            <div key={i} className="my-3 flex justify-center">
              <img
                src={segment.value}
                alt={segment.alt || "문제 이미지"}
                className="max-h-[400px] rounded-lg border border-border object-contain"
                loading="lazy"
              />
            </div>
          );
        }

        if (segment.type === "text") {
          // Preserve newlines in plain text
          const lines = segment.value.split("\n");
          return (
            <span key={i}>
              {lines.map((line, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {line}
                </span>
              ))}
            </span>
          );
        }

        if (segment.type === "block-math") {
          return (
            <div
              key={i}
              className="my-3"
              dangerouslySetInnerHTML={{
                __html: renderKatex(segment.value, true),
              }}
            />
          );
        }

        // inline-math
        return (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: renderKatex(segment.value, false),
            }}
          />
        );
      })}
    </div>
  );
}
