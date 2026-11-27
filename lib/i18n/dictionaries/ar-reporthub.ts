// Default Arabic for the Report Hub. Must match en-reporthub.ts exactly (typed).
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

export const arReportHub: Dictionary["reportHub"] = {
  intro: "اختر تقريرًا. تظهر فقط التقارير التي يمكن لحسابك فتحها.",
  groups: {
    financial: "التقارير المالية",
    inventory: "تقارير المخزون",
    partners: "تقارير العملاء والموردين",
  },
  reports: {
    profitLoss: "الإيرادات وتكلفة البضاعة المباعة والمصروفات والربح خلال فترة.",
    cashFlow: "الأموال الداخلة والخارجة خلال فترة.",
    aging: "أرصدة العملاء والموردين غير المسددة مصنَّفة حسب عمرها.",
    stockBalance: "كميات المخزون الحالية في كل مستودع.",
    productMovement: "المخزون الوارد والصادر خلال فترة.",
    lowStock: "المنتجات التي بلغت حد تنبيه المخزون أو أقل.",
    customerStatement: "حركات العميل ورصيده المتراكم.",
    supplierStatement: "حركات المورد ورصيده المتراكم.",
  },
  noWarehouse: "لا يوجد مستودع معيَّن لحسابك، لذا ستظهر هذه التقارير فارغة. اطلب من المالك أو المدير تعيين مستودع.",
  forecasting: "التوقعات والتحليلات",
  forecastingBody: "توقعات المبيعات والمخزون والتدفق النقدي غير متاحة بعد.",
  noAccessTitle: "لا توجد تقارير متاحة لك",
  noAccessBody: "لا يتضمن دورك أي تقرير في هذه الصفحة. اطلب من المالك أو المدير إذا كنت تحتاج إلى أحدها.",
};
