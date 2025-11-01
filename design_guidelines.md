# Coffee KPI Dashboard - Design Guidelines

## Design Approach: Professional Business Analytics System

**Selected Approach:** Design System - Data-Focused Analytics Dashboard
**Primary References:** Linear's clean aesthetics, Stripe Dashboard's professional metrics display, Carbon Design System for data-heavy applications

**Core Principles:**

- Data clarity over decoration
- Efficient information hierarchy
- Professional business tool aesthetic
- Scannable KPI presentation

---

## Color Palette

### Dark Mode (Primary Interface)

- **Background Base:** 222 15% 8% (deep charcoal)
- **Surface Cards:** 222 15% 12% (elevated dark)
- **Borders/Dividers:** 222 10% 18% (subtle contrast)
- **Primary Brand:** 198 93% 60% (cyan blue - data clarity)
- **Success/Growth:** 142 76% 36% (professional green)
- **Warning/Decline:** 0 84% 60% (alert red)
- **Text Primary:** 210 20% 98% (near white)
- **Text Secondary:** 215 16% 65% (muted blue-gray)

### Light Mode (Alternative)

- **Background:** 210 20% 98%
- **Surface Cards:** 0 0% 100%
- **Primary:** 198 93% 45%
- **Text:** 222 15% 15%

---

## Typography

**Font Stack:**

- Primary: 'Inter', system-ui, sans-serif (via Google Fonts)
- Monospace: 'JetBrains Mono', monospace (for data/numbers)

**Hierarchy:**

- **Dashboard Title:** text-2xl font-bold tracking-tight
- **Section Headers:** text-lg font-semibold
- **KPI Values:** text-3xl md:text-4xl font-bold font-mono (tabular nums)
- **KPI Labels:** text-sm font-medium text-secondary
- **Body Text:** text-base
- **Table Data:** text-sm font-mono (numbers), text-sm (text)
- **Percentage Changes:** text-sm font-semibold

---

## Layout System

**Spacing Primitives:** Consistent use of Tailwind units: 2, 4, 6, 8, 12, 16

- Component padding: p-4 to p-6
- Section gaps: gap-4 to gap-6
- Page margins: px-4 md:px-8 lg:px-12

**Grid Structure:**

- Container: max-w-7xl mx-auto
- KPI Cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4
- Charts: grid-cols-1 lg:grid-cols-2 gap-6
- Full-width tables: w-full

---

## Component Library

### 1. Dashboard Header

- Dark background with subtle border-bottom
- Title (Coffee KPI Dashboard) + date range selector
- Upload button (primary cyan) in top-right
- Height: h-16, sticky positioning

### 2. File Upload Zone

- Large dashed border card (border-dashed border-2)
- Upload icon (cloud upload) centered
- "Drag & drop or click to upload" text
- Supported formats badge: .xlsx, .csv
- Active state: border-primary bg-primary/5

### 3. KPI Cards

- Elevated card with rounded corners (rounded-lg)
- Icon top-left (Heroicons: trending up/down, currency, receipt)
- Large numeric value (font-mono for tabular alignment)
- Label below value
- Percentage change badge with arrow (↑/↓)
- Color-coded badges: green (positive), red (negative), gray (neutral)
- Subtle shadow: shadow-sm hover:shadow-md transition

### 4. Chart Containers

- White/dark card backgrounds
- Title with time period selector (Day/Month/Year tabs)
- Chart.js canvas with responsive sizing
- Legend positioned top-right
- Grid lines: subtle gray, reduced opacity
- Tooltips: dark bg with rounded corners

### 5. Data Table

- Striped rows (alternate bg colors)
- Sticky header with sort indicators
- Monospace font for numeric columns
- Right-aligned numbers, left-aligned text
- Row hover state: subtle bg change
- Pagination controls at bottom

### 6. Navigation/Tabs

- Segmented control style for time periods
- Active tab: bg-primary text-white
- Inactive: text-secondary hover:bg-surface
- Rounded full group: rounded-full p-1

### 7. Buttons

- Primary: bg-primary hover:bg-primary-dark rounded-lg px-4 py-2
- Secondary: border border-primary text-primary hover:bg-primary/10
- Icon buttons: square aspect, rounded-md, p-2

---

## Data Visualization Specs

**Chart.js Configuration:**

- Color scheme: Primary cyan for main data, gradient fills with opacity
- Grid: color matching border colors, 0.1 opacity
- Font family: Inter for labels, JetBrains Mono for values
- Responsive: maintainAspectRatio: true, aspectRatio: 2
- Tooltips: Dark background, rounded corners, padding: 12px
- Line charts: 2px stroke, smooth curves, point radius: 4

**Growth Indicators:**

- Upward trend: ↑ text-success (green)
- Downward trend: ↓ text-warning (red)
- Neutral: — text-secondary (gray)
- Badge format: rounded-full px-2 py-0.5 text-xs font-semibold

---

## Interaction Patterns

- **File Upload:** Drag-and-drop with visual feedback, progress indicator during processing
- **Chart Interactions:** Hover tooltips, click period tabs to switch views
- **Table Actions:** Click headers to sort, hover rows for actions
- **Loading States:** Skeleton cards matching final layout, spinner for file processing
- **Error States:** Alert banners (red) with clear messaging, retry action

---

## Responsive Behavior

- **Mobile (<768px):** Single column KPI cards, stacked charts, horizontal scroll tables
- **Tablet (768-1024px):** 2-column KPI grid, stacked charts
- **Desktop (>1024px):** 4-column KPI grid, side-by-side charts

---

## Icons

**Library:** Heroicons (via CDN)

- Upload: cloud-arrow-up
- Revenue: currency-dollar
- Checks: receipt-percent
- Growth: arrow-trending-up/down
- Calendar: calendar-days
- Chart: chart-bar
