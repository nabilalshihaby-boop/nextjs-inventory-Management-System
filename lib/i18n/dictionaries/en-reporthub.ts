// Report Hub (/reports). Card titles reuse the sidebar / page titles (dict.nav); only the texts below are new.
export const enReportHub = {
  intro: "Choose a report. Only the reports your account can open are listed.",
  groups: {
    financial: "Financial Reports",
    inventory: "Inventory Reports",
    partners: "Customer & Supplier Reports",
  },
  reports: {
    profitLoss: "Revenue, cost of goods sold, expenses and profit for a period.",
    cashFlow: "Money in and money out for a period.",
    aging: "Unpaid customer and supplier balances grouped by age.",
    stockBalance: "Current stock quantities in each warehouse.",
    productMovement: "Stock coming in and going out over a period.",
    lowStock: "Products that are at or below their stock alert level.",
    customerStatement: "A customer's transactions and running balance.",
    supplierStatement: "A supplier's transactions and running balance.",
  },
  noWarehouse: "No warehouse is assigned to your account, so these reports will be empty. Ask an Owner or Administrator to assign one.",
  forecasting: "Forecasting & Insights",
  forecastingBody: "Sales, stock and cash-flow forecasts are not available yet.",
  noAccessTitle: "No reports are available to you",
  noAccessBody: "Your role does not include a report on this page. Ask an Owner or Administrator if you need one.",
};
