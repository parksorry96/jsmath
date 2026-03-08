# UI/UX Overhaul Design — 2026-03-07

## Problem
- Math formula overflow (text clipped on right side)
- Original image panel wastes 50% of screen (images not available)
- Raw LaTeX exposed in problem list thumbnails
- Solution section uses light-theme colors in dark theme
- No batch review, no filters, no progress tracking
- Approve/reject buttons require scrolling to bottom
- Review queue renders 200+ items in a long list

## Design (4-team analysis approved)

### Layout Change: Review Page
- Remove original image panel entirely
- Single-column full-width layout for OCR result
- Sticky nav bar with: prev/next, compact problem number grid, approve/reject buttons
- Filter bar: confidence level (>=90%, 75-90%, <75%), review status
- Progress bar showing reviewed/total count
- Metadata chips: unit, difficulty, type, answer, points
- AI analysis expanded by default
- Solution section with dark theme consistent colors
- Auto-advance to next unreviewed problem after action

### Fix: Problems Page
- Strip LaTeX tags from preview text (use stemText, remove $...$ patterns)

### Fix: LatexRenderer
- Add overflow-x-auto to prevent horizontal clipping
- Add word-break for long text segments

### Fix: Upload Page
- Dark theme consistent input styling

### Fix: Global
- Solution section bg-blue-50 -> dark theme variant

## Implementation Streams (parallel)
1. Review page overhaul (review/page.tsx)
2. Problems page + Dashboard + Upload fixes
3. LatexRenderer + CSS cross-cutting fixes
