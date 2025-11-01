# Coffee KPI Dashboard

## Overview

This project is a web application designed to analyze financial and operational key performance indicators (KPIs) for coffee shops. It processes data from various file formats (Excel, CSV, PDF) to provide comprehensive insights into revenue, average check, transaction counts, and payment methods. The application aims to offer an intuitive and visually rich dashboard for business owners to monitor performance, identify trends, and make informed decisions, ultimately supporting growth and operational efficiency.

## User Preferences

The user wants to interact with the system through a modern, visually appealing interface with bright and saturated colors, gradient elements, and clear typography. They prefer detailed analytical breakdowns, including month-over-month growth, day-over-day comparisons, and an understanding of payment method distribution. The user also values an intuitive workflow for data upload and navigation between different analytical views.

## System Architecture

### UI/UX Decisions

The frontend is built with React and TypeScript, leveraging Tailwind CSS and Shadcn UI for a modern, responsive, and visually rich user experience. The design emphasizes bright, saturated colors, gradient backgrounds, glassmorphic effects, and gradient text for visual hierarchy. KPI cards are modernized with gradient overlays, shadowed icons, and hover effects. Chart.js is used for data visualization, featuring gradient fills, thick lines, large data points, and informative tooltips with modern styling. Navigation is handled by an `AppSidebar` with icons and active page highlighting.

### Technical Implementations

- **Frontend**: React, TypeScript, Tailwind CSS, Shadcn UI, Chart.js, React Dropzone, TanStack Query, Framer Motion.
- **Backend**: Node.js, Express.
- **File Parsing**: XLSX (SheetJS) for Excel, Papa Parse for CSV, pdf-parse for PDF (specifically Z-reports from cash registers).
- **Data Storage**: In-memory storage for transaction data.
- **Auto-detection**: Intelligent column auto-detection for various fields (Date, Year, Month, Amount, Payment types, Category, Employee) in both Russian and English.
- **KPI Calculation**: Comprehensive analytics module calculates various KPIs including total revenue, MoM growth, average check, transaction count, DoD revenue growth, and monthly average checks per day.
- **Visualization Components**: `OverviewPage`, `MonthlyReportPage`, `SalesPage`, `PaymentsPage`, `DataPage` provide specialized dashboards. Reusable components include `FileUpload`, `KPICard`, `StatCard`, `ProgressBar`, `PeriodTabs`, `RevenueChart`, `DayOfWeekChart`, and `DataTable`.
- **Animations & Visual Effects**:
  - **AnimatedBackground**: Component with floating particles, coffee icons (Coffee, Sparkles, Circle), and animated gradient blobs using Framer Motion
  - **Enhanced FileUpload**: Features smooth transitions, animated icons with glow effects, gradient backgrounds, and interactive hover states
  - **Landing Page**: Staggered animations for title, subtitle, description, and feature cards with smooth fade-in effects
  - **Dashboard Pages**: Subtle framer-motion animations applied to all dashboard pages (Overview, Monthly Report, Sales, Payments, Data) with restrained fade/slide-ins to maintain focus on data analytics
- **Data Schema**: TypeScript types define transaction and analytics schemas, including detailed payment types (cash, terminal, QR, SBP), year, and month.

### Feature Specifications

- **Multi-dashboard structure**: Dedicated sections for Overview, Monthly Report, Sales Analytics, Payment Analysis, and Raw Data.
- **File Upload**: Supports Excel, CSV, and PDF (Z-reports).
- **Automated Data Processing**: Auto-detection of key columns, parsing of transactional data, and extraction of specific fields like `checksCount` from PDFs.
- **Key Performance Indicators**:
  - Revenue (total, MoM growth, DoD growth)
  - Average Check (total, MoM growth)
  - Transaction Count (total, MoM growth, current month, average per day)
- **Monthly Report**: Comprehensive comparison page showing:
  - Side-by-side comparison of current month vs previous month
  - Detailed KPIs for both periods (revenue, checks, average check)
  - Payment method breakdown with doughnut charts for each month
  - Daily trend visualization for both months
  - Growth percentages with visual indicators
  - **Period-to-Period Comparison**: Compares accumulated metrics from the start of the current month to the current day with the same period in the previous month
    - Example: If today is October 13th, compares Oct 1-13 with Sep 1-13
    - Includes revenue, checks, average check, and payment breakdowns for both periods
    - Handles month overflow (e.g., comparing 31st of a month with a 30-day previous month)
    - Shows growth percentages between the two periods
- **Interactive Visualizations**:
  - Line and bar charts for revenue trends (daily, monthly, yearly).
  - Day-of-week analysis chart with color-coding for most/least profitable days.
  - Doughnut charts for payment method distribution.
  - Detailed data tables with sorting.
- **Period Switching**: Ability to view data by day, month, or year.

### System Design Choices

- **Modular Architecture**: Clear separation between frontend and backend, and within frontend components for maintainability and scalability.
- **In-memory Storage**: Simplifies data handling for single-session analysis, suitable for the current scope.
- **Robust Parsing**: Utilizes specialized libraries for accurate and comprehensive parsing of diverse file formats, including handling date formatting inconsistencies and extracting specific payment types.
- **Dynamic Charting**: Chart.js is configured for dynamic data display, including gradient fills, custom tooltips, and responsive design.

## External Dependencies

- **XLSX (SheetJS)**: For parsing Excel files (`.xlsx`, `.xls`).
- **Papa Parse**: For parsing CSV files.
- **pdf-parse**: For extracting data from PDF files, specifically Z-reports from cash registers.
- **Chart.js**: For generating interactive data visualizations and graphs.
- **React Dropzone**: For implementing drag-and-drop file upload functionality.
- **TanStack Query**: For data fetching, caching, and state management in the frontend.
- **Framer Motion**: For smooth animations and transitions on the landing page and upload components.

## Recent Changes (October 2025)

- Redesigned landing page with vibrant colors and dynamic animations
- Added animated background with floating particles and gradient blobs
- Enhanced file upload component with smooth transitions and interactive effects
- Implemented staggered animations on landing page for improved user experience
- Applied subtle framer-motion animations to all dashboard pages (Overview, Monthly Report, Sales, Payments, Data)
- Dashboard animations use restrained fade/slide-ins to maintain focus on data analytics
- Increased color saturation in CSS variables for more vibrant appearance
- **Fixed MoM growth calculations**: Changed logic to compare same periods (e.g., Oct 1-16 vs Sep 1-16) instead of comparing full previous month with current incomplete month, which always showed negative growth
- **Fixed revenue trend on Sales Analytics page**: Monthly trend now uses period-based comparison from KPI metrics for accurate growth calculation
- **Added refund support (October 16, 2025)**:
  - Added 5 refund fields to schema: refundChecksCount, refundCashPayment, refundTerminalPayment, refundQrPayment, refundSbpPayment
  - Enhanced column detection with three-pass matching (exact phrase → exact word → substring) to prevent conflicts between similar column names
  - Updated Excel and CSV parsers to detect and process refund columns from Russian Z-reports
  - **Net revenue calculation**: Amount now correctly calculated as (Income - Refunds) for accurate financial metrics
  - Refund columns detected: "Чеков возврата прихода", "Возврат наличными", "Возврат безналичными", etc.
  - **Known limitation**: PDF parser doesn't support refunds yet (uses regex-based extraction, different from Excel/CSV column detection)
