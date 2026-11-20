/* @ds-bundle: {"format":4,"namespace":"Industry_indust","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"Pagination","sourcePath":"components/data/Pagination.jsx"},{"name":"RowMenu","sourcePath":"components/data/RowMenu.jsx"},{"name":"StatCard","sourcePath":"components/data/StatCard.jsx"},{"name":"TableToolbar","sourcePath":"components/data/TableToolbar.jsx"},{"name":"Tabs","sourcePath":"components/data/Tabs.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Field","sourcePath":"components/forms/Field.jsx"},{"name":"FormCard","sourcePath":"components/forms/FormCard.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"ConfirmDeleteModal","sourcePath":"components/overlay/ConfirmDeleteModal.jsx"},{"name":"Modal","sourcePath":"components/overlay/Modal.jsx"},{"name":"AppShell","sourcePath":"components/shell/AppShell.jsx"},{"name":"PageHeader","sourcePath":"components/shell/PageHeader.jsx"},{"name":"Sidebar","sourcePath":"components/shell/Sidebar.jsx"},{"name":"Topbar","sourcePath":"components/shell/Topbar.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"fb13adca7724","components/core/Button.jsx":"d4cfe2bf3cfa","components/core/Icon.jsx":"023a018a360e","components/data/DataTable.jsx":"9803003d3bdc","components/data/Pagination.jsx":"bfa7936402de","components/data/RowMenu.jsx":"a5357e2a67c2","components/data/StatCard.jsx":"b82098131816","components/data/TableToolbar.jsx":"8693eb88f5f5","components/data/Tabs.jsx":"5eb51b5570ee","components/forms/Checkbox.jsx":"883ae1bc8158","components/forms/Field.jsx":"84b2e13deb5e","components/forms/FormCard.jsx":"d0c44ccaa0d1","components/forms/Input.jsx":"fd99a062b68e","components/forms/Select.jsx":"5ab23be742f4","components/forms/Switch.jsx":"df892e2faed1","components/forms/Textarea.jsx":"c7c5ab65c993","components/overlay/ConfirmDeleteModal.jsx":"d8cfe403f1fd","components/overlay/Modal.jsx":"dcd275dd4a99","components/shell/AppShell.jsx":"494c3f1af145","components/shell/PageHeader.jsx":"eef0e9f08458","components/shell/Sidebar.jsx":"0731d2ad011d","components/shell/Topbar.jsx":"34280705f152","customer-data.js":"5a8fc17f77f5","demo.js":"5f8a6cec4401","demo.jsx":"9708a3ef097e","fin.js":"45fe02a21e54","finui.jsx":"f3df74ebbf5f","lock.jsx":"d01db5748770","nav.js":"2225507fa4aa","tabs.js":"a53ada2680b0","theme.js":"473666cecf0f"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.Industry_indust = window.Industry_indust || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
const MAP = {
  paid: "success",
  received: "success",
  completed: "success",
  delivered: "success",
  active: "success",
  unpaid: "danger",
  cancelled: "danger",
  overdue: "danger",
  pending: "warning",
  partial: "warning",
  ordered: "warning",
  hold: "warning",
  sent: "info",
  draft: "neutral"
};
function Badge({
  status,
  tone,
  dot = true,
  children
}) {
  const label = children ?? status;
  const t = tone || MAP[String(status || "").toLowerCase()] || "neutral";
  return /*#__PURE__*/React.createElement("span", {
    className: "sp-badge sp-badge--" + t
  }, dot && /*#__PURE__*/React.createElement("i", null), label);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function Icon({
  name,
  size = 18,
  className = "",
  style
}) {
  const u = "https://unpkg.com/lucide-static@0.468.0/icons/" + name + ".svg";
  return /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    className: "sp-icon " + className,
    style: {
      width: size,
      height: size,
      WebkitMaskImage: "url(" + u + ")",
      maskImage: "url(" + u + ")",
      ...style
    }
  });
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  iconOnly = false,
  className = "",
  children,
  ...rest
}) {
  const c = ["sp-btn", "sp-btn--" + variant, size !== "md" && "sp-btn--" + size, iconOnly && "sp-btn--icon", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: c
  }, rest), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: size === "sm" ? 16 : 18
  }), children, iconRight && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: 16
  }));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/data/Pagination.jsx
try { (() => {
function Pagination({
  page = 1,
  pageSize = 10,
  total = 0,
  onPage,
  onPageSize
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const B = ({
    ic,
    go,
    dis,
    l
  }) => /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon",
    "aria-label": l,
    disabled: dis,
    onClick: () => onPage && onPage(go)
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: ic,
    size: 18
  }));
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-pager"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sp-pager-l"
  }, /*#__PURE__*/React.createElement("span", null, "Rows per page"), /*#__PURE__*/React.createElement("select", {
    className: "sp-select",
    value: pageSize,
    onChange: e => onPageSize && onPageSize(+e.target.value)
  }, [10, 25, 50, 100].map(n => /*#__PURE__*/React.createElement("option", {
    key: n
  }, n))), /*#__PURE__*/React.createElement("span", null, from, "\u2013", to, " of ", total)), /*#__PURE__*/React.createElement("div", {
    className: "sp-pager-r"
  }, /*#__PURE__*/React.createElement(B, {
    ic: "chevrons-left",
    go: 1,
    dis: page <= 1,
    l: "First"
  }), /*#__PURE__*/React.createElement(B, {
    ic: "chevron-left",
    go: page - 1,
    dis: page <= 1,
    l: "Previous"
  }), /*#__PURE__*/React.createElement(B, {
    ic: "chevron-right",
    go: page + 1,
    dis: page >= last,
    l: "Next"
  }), /*#__PURE__*/React.createElement(B, {
    ic: "chevrons-right",
    go: last,
    dis: page >= last,
    l: "Last"
  })));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/data/RowMenu.jsx
try { (() => {
function RowMenu({
  items = []
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-rowmenu",
    ref: ref
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "sp-btn sp-btn--ghost sp-btn--sm sp-btn--icon",
    "aria-label": "Row actions",
    onClick: () => setOpen(!open)
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "ellipsis-vertical",
    size: 18
  })), open && /*#__PURE__*/React.createElement("div", {
    className: "sp-menu"
  }, items.map((it, i) => it === "-" ? /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "sp-menu-sep"
  }) : /*#__PURE__*/React.createElement("button", {
    key: i,
    type: "button",
    className: "sp-menu-item" + (it.danger ? " sp-menu-item--danger" : ""),
    onClick: () => {
      setOpen(false);
      it.onClick && it.onClick();
    }
  }, it.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: it.icon,
    size: 16
  }), it.label))));
}
Object.assign(__ds_scope, { RowMenu });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/RowMenu.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
function DataTable({
  columns = [],
  rows = [],
  rowKey = "id",
  actions,
  dense = false,
  footer,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-table-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sp-table-scroll"
  }, /*#__PURE__*/React.createElement("table", {
    className: "sp-table" + (dense ? " sp-table--dense" : "")
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    className: c.align === "right" ? "num" : "",
    style: c.width ? {
      width: c.width
    } : undefined
  }, c.header)), actions && /*#__PURE__*/React.createElement("th", {
    className: "act"
  }, "Action"))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: r[rowKey] ?? i
  }, columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    className: (c.align === "right" ? "num " : "") + (c.primary ? "primary-cell" : "")
  }, c.render ? c.render(r[c.key], r) : r[c.key])), actions && /*#__PURE__*/React.createElement("td", {
    className: "act"
  }, /*#__PURE__*/React.createElement(__ds_scope.RowMenu, {
    items: actions(r)
  }))))), footer && /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, columns.map((c, i) => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    className: c.align === "right" ? "num" : ""
  }, i === 0 && footer[c.key] === undefined ? "Total" : footer[c.key])), actions && /*#__PURE__*/React.createElement("td", null))))), children);
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/StatCard.jsx
try { (() => {
function StatCard({
  tone = "teal",
  icon,
  value,
  label,
  note
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-stat sp-stat--" + tone
  }, icon && /*#__PURE__*/React.createElement("div", {
    className: "sp-stat-icon"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 28
  })), /*#__PURE__*/React.createElement("div", {
    className: "sp-stat-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sp-stat-value"
  }, value), /*#__PURE__*/React.createElement("div", {
    className: "sp-stat-label"
  }, label), note && /*#__PURE__*/React.createElement("div", {
    className: "sp-stat-note"
  }, note)));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/data/Tabs.jsx
try { (() => {
function Tabs({
  tabs = [],
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-tabs",
    role: "tablist"
  }, tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    type: "button",
    role: "tab",
    className: "sp-tab",
    "aria-selected": t.id === value,
    onClick: () => onChange && onChange(t.id)
  }, t.label)));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Checkbox({
  label,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: "sp-check"
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox"
  }, rest)), label);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Field.jsx
try { (() => {
function Field({
  label,
  required,
  hint,
  error,
  className = "",
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-field" + (error ? " sp-field--error" : "") + (className ? " " + className : "")
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "sp-label"
  }, label, required && /*#__PURE__*/React.createElement("i", null, "*")), children, error ? /*#__PURE__*/React.createElement("span", {
    className: "sp-error"
  }, error) : hint ? /*#__PURE__*/React.createElement("span", {
    className: "sp-hint"
  }, hint) : null);
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

// components/forms/FormCard.jsx
try { (() => {
function FormCard({
  columns = 2,
  onSave,
  onCancel,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  hideActions = false,
  saveDisabled = false,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-card sp-form-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sp-form-grid",
    style: {
      "--cols": columns
    }
  }, children), !hideActions && /*#__PURE__*/React.createElement("div", {
    className: "sp-form-actions"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "secondary",
    onClick: onCancel
  }, cancelLabel), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    disabled: saveDisabled,
    onClick: onSave
  }, saveLabel)));
}
Object.assign(__ds_scope, { FormCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/FormCard.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  icon,
  addon,
  addonSide = "right",
  className = "",
  ...rest
}) {
  const el = /*#__PURE__*/React.createElement("input", _extends({
    className: "sp-input " + className
  }, rest));
  if (!icon && !addon) return el;
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-group"
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 18,
    className: "sp-input-icon"
  }), addon && addonSide === "left" && /*#__PURE__*/React.createElement("span", {
    className: "sp-addon sp-addon--l"
  }, addon), el, addon && addonSide === "right" && /*#__PURE__*/React.createElement("span", {
    className: "sp-addon sp-addon--r"
  }, addon));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/data/TableToolbar.jsx
try { (() => {
function TableToolbar({
  searchPlaceholder = "Search",
  value,
  onSearch,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-toolbar"
  }, /*#__PURE__*/React.createElement(__ds_scope.Input, {
    icon: "search",
    placeholder: searchPlaceholder,
    value: value,
    onChange: e => onSearch && onSearch(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    className: "sp-grow"
  }), children);
}
Object.assign(__ds_scope, { TableToolbar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/TableToolbar.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  options = [],
  placeholder,
  className = "",
  defaultValue,
  value,
  ...rest
}) {
  const p = value === undefined && defaultValue === undefined && placeholder ? {
    defaultValue: ""
  } : {
    defaultValue,
    value
  };
  return /*#__PURE__*/React.createElement("select", _extends({
    className: "sp-select " + className
  }, p, rest), placeholder && /*#__PURE__*/React.createElement("option", {
    value: "",
    disabled: true
  }, placeholder), options.map(o => typeof o === "string" ? /*#__PURE__*/React.createElement("option", {
    key: o,
    value: o
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  label,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: "sp-switch"
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch"
  }, rest)), label);
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Textarea({
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("textarea", _extends({
    className: "sp-textarea " + className
  }, rest));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Modal.jsx
try { (() => {
function Modal({
  open = true,
  title,
  size = "md",
  onClose,
  footer,
  children
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-overlay",
    onMouseDown: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sp-modal sp-modal--" + size,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title
  }, /*#__PURE__*/React.createElement("div", {
    className: "sp-modal-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-section-title"
  }, title), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "sm",
    iconOnly: true,
    icon: "x",
    "aria-label": "Close",
    onClick: onClose
  })), /*#__PURE__*/React.createElement("div", {
    className: "sp-modal-body"
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "sp-modal-foot"
  }, footer)));
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Modal.jsx", error: String((e && e.message) || e) }); }

// components/overlay/ConfirmDeleteModal.jsx
try { (() => {
function ConfirmDeleteModal({
  open = false,
  itemType = "item",
  itemName,
  onConfirm,
  onCancel
}) {
  const title = itemName ? "Delete " + itemName + "?" : "Delete " + itemType + "?";
  return /*#__PURE__*/React.createElement(__ds_scope.Modal, {
    open: open,
    size: "sm",
    title: title,
    onClose: onCancel,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(__ds_scope.Button, {
      variant: "secondary",
      onClick: onCancel
    }, "Cancel"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
      variant: "danger",
      icon: "trash-2",
      onClick: onConfirm
    }, "Delete"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 16,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      width: 44,
      height: 44,
      borderRadius: "50%",
      background: "var(--danger-50)",
      color: "var(--danger-700)",
      display: "grid",
      placeItems: "center",
      boxShadow: "inset 0 0 0 1px var(--danger-100)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "triangle-alert",
    size: 22
  })), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      margin: 0,
      color: "var(--text-2)"
    }
  }, "Are you sure you want to delete this ", itemType, "? This action cannot be undone.")));
}
Object.assign(__ds_scope, { ConfirmDeleteModal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/ConfirmDeleteModal.jsx", error: String((e && e.message) || e) }); }

// components/shell/PageHeader.jsx
try { (() => {
function PageHeader({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-page-head"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "t-page-title",
    style: {
      margin: 0
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12
    }
  }, children));
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/shell/Sidebar.jsx
try { (() => {
function Sidebar({
  brand = "Sontic Plus",
  items = [],
  activeId,
  collapsed = false,
  onToggle,
  onNavigate
}) {
  const owner = items.find(g => g.children && g.children.some(c => c.id === activeId));
  const [open, setOpen] = React.useState(owner ? owner.id : null);
  return /*#__PURE__*/React.createElement("aside", {
    className: "sp-sidebar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sp-brand"
  }, /*#__PURE__*/React.createElement("span", {
    className: "sp-brand-text"
  }, /*#__PURE__*/React.createElement("b", null, brand[0]), /*#__PURE__*/React.createElement("span", {
    className: "sp-brand-name"
  }, brand.slice(1))), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "sm",
    iconOnly: true,
    icon: "panel-left-close",
    "aria-label": "Collapse sidebar",
    onClick: onToggle
  })), /*#__PURE__*/React.createElement("nav", {
    className: "sp-nav"
  }, collapsed && /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "sm",
    iconOnly: true,
    icon: "panel-left-open",
    "aria-label": "Expand sidebar",
    onClick: onToggle,
    style: {
      alignSelf: "center",
      marginBottom: 8
    }
  }), items.map(it => {
    const has = !!it.children;
    const active = it.id === activeId || has && it.children.some(c => c.id === activeId);
    const exp = open === it.id;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: it.id
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "sp-nav-item",
      title: collapsed ? it.label : undefined,
      "aria-current": active && !has ? "page" : undefined,
      "aria-expanded": has ? exp : undefined,
      style: active && has ? {
        color: "var(--primary-700)"
      } : undefined,
      onClick: () => {
        if (has) setOpen(exp ? null : it.id);else onNavigate && onNavigate(it.id);
      }
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon,
      size: 20
    }), /*#__PURE__*/React.createElement("span", {
      className: "sp-nav-label"
    }, it.label), has && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "chevron-down",
      size: 16,
      className: "sp-chev"
    })), has && exp && /*#__PURE__*/React.createElement("div", {
      className: "sp-nav-sub"
    }, it.children.map(c => /*#__PURE__*/React.createElement("button", {
      key: c.id,
      type: "button",
      className: "sp-nav-item",
      "aria-current": c.id === activeId ? "page" : undefined,
      onClick: () => onNavigate && onNavigate(c.id)
    }, c.label))));
  })));
}
Object.assign(__ds_scope, { Sidebar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/Sidebar.jsx", error: String((e && e.message) || e) }); }

// components/shell/Topbar.jsx
try { (() => {
function Topbar({
  onSearch,
  onBell,
  tabs = [],
  activeTab,
  moreTabs = [],
  title,
  userName = "Admin",
  userRole = "Administrator",
  onPos,
  onSignOut,
  onMenu
}) {
  const [open, setOpen] = React.useState(false);
  const [more, setMore] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return /*#__PURE__*/React.createElement("header", {
    className: "sp-topbar"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    iconOnly: true,
    icon: "menu",
    className: "sp-menu-btn",
    "aria-label": "Open navigation menu",
    onClick: onMenu
  }), tabs.length ? /*#__PURE__*/React.createElement("nav", {
    className: "sp-toptabs"
  }, tabs.map(x => /*#__PURE__*/React.createElement("a", {
    key: x.id,
    href: x.href,
    className: "sp-toptab",
    "aria-current": x.id === activeTab ? "page" : undefined
  }, x.label)), moreTabs.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "sp-toptab",
    "aria-current": moreTabs.some(x => x.id === activeTab) ? "page" : undefined,
    onClick: () => setMore(!more),
    onBlur: () => setTimeout(() => setMore(false), 150),
    style: {
      background: "none",
      border: 0,
      cursor: "pointer",
      gap: 4
    }
  }, "More", /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16
  })), more && /*#__PURE__*/React.createElement("div", {
    className: "sp-menu",
    style: {
      right: "auto",
      left: 0
    }
  }, moreTabs.map(x => /*#__PURE__*/React.createElement("a", {
    key: x.id,
    href: x.href || "#",
    className: "sp-menu-item",
    style: {
      textDecoration: "none"
    }
  }, x.label))))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "sp-crumb"
  }, title), /*#__PURE__*/React.createElement(__ds_scope.Input, {
    icon: "search",
    placeholder: "Search products by name or code",
    onKeyDown: e => {
      if (e.key === "Enter" && onSearch) onSearch(e.target.value);
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "sp-topbar-r"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "accent",
    icon: "monitor-smartphone",
    onClick: onPos
  }, "POS"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    iconOnly: true,
    icon: "maximize",
    "aria-label": "Fullscreen",
    onClick: () => document.documentElement.requestFullscreen && document.documentElement.requestFullscreen()
  }), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    iconOnly: true,
    icon: "bell",
    "aria-label": "Low stock alerts",
    onClick: onBell
  }), /*#__PURE__*/React.createElement("div", {
    className: "sp-user",
    ref: ref
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "sp-user-btn",
    onClick: () => setOpen(!open)
  }, /*#__PURE__*/React.createElement("span", {
    className: "sp-avatar"
  }, userName[0].toUpperCase()), /*#__PURE__*/React.createElement("span", null, userName, /*#__PURE__*/React.createElement("small", null, userRole)), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16
  })), open && /*#__PURE__*/React.createElement("div", {
    className: "sp-menu"
  }, /*#__PURE__*/React.createElement("a", {
    href: "Settings.html",
    className: "sp-menu-item",
    style: {
      textDecoration: "none"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "user",
    size: 16
  }), "Profile"), /*#__PURE__*/React.createElement("a", {
    href: "Settings.html",
    className: "sp-menu-item",
    style: {
      textDecoration: "none"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "settings",
    size: 16
  }), "Settings"), /*#__PURE__*/React.createElement("div", {
    className: "sp-menu-sep"
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "sp-menu-item sp-menu-item--danger",
    onClick: onSignOut
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "log-out",
    size: 16
  }), "Sign out")))));
}
Object.assign(__ds_scope, { Topbar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/Topbar.jsx", error: String((e && e.message) || e) }); }

// components/shell/AppShell.jsx
try { (() => {
function AppShell({
  onPos,
  onSignOut,
  onSearch,
  onBell,
  tabs,
  activeTab,
  moreTabs,
  items = [],
  activeId,
  title,
  userName,
  userRole,
  onNavigate,
  defaultCollapsed = false,
  footer = "© 2026 Sontic Plus. All rights reserved.",
  children
}) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const mq = () => window.matchMedia && matchMedia("(max-width:1279px)").matches;
  const [narrow, setNarrow] = React.useState(mq);
  const [drawer, setDrawer] = React.useState(false);
  React.useEffect(() => {
    if (!window.matchMedia) return;
    const m = matchMedia("(max-width:1279px)"),
      f = () => {
        setNarrow(m.matches);
        if (!m.matches) setDrawer(false);
      };
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  React.useEffect(() => {
    if (!drawer) return;
    const k = e => {
      if (e.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [drawer]);
  const col = collapsed && !narrow;
  const R = window.SP_ROUTES || {};
  const nav = onNavigate || (id => {
    if (R[id]) location.href = R[id];
  });
  const pos = onPos || (() => {
    location.href = "POS.html";
  });
  const out = onSignOut || (() => {
    location.href = "Sign In.html";
  });
  const srch = onSearch || (q => {
    location.href = "Products.html?q=" + encodeURIComponent(q);
  });
  const bell = onBell || (() => {
    location.href = "Products.html";
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "sp-shell",
    "data-collapsed": col,
    "data-drawer": narrow && drawer
  }, /*#__PURE__*/React.createElement(__ds_scope.Sidebar, {
    items: items,
    activeId: activeId,
    collapsed: col,
    onToggle: () => narrow ? setDrawer(false) : setCollapsed(!collapsed),
    onNavigate: nav
  }), /*#__PURE__*/React.createElement("div", {
    className: "sp-backdrop",
    onClick: () => setDrawer(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "sp-main"
  }, /*#__PURE__*/React.createElement(__ds_scope.Topbar, {
    onMenu: () => setDrawer(true),
    onPos: pos,
    onSignOut: out,
    onSearch: srch,
    onBell: bell,
    tabs: tabs,
    activeTab: activeTab,
    moreTabs: moreTabs,
    title: title,
    userName: userName,
    userRole: userRole
  }), /*#__PURE__*/React.createElement("main", {
    className: "sp-content"
  }, children), /*#__PURE__*/React.createElement("footer", {
    className: "sp-footer"
  }, footer)));
}
Object.assign(__ds_scope, { AppShell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/AppShell.jsx", error: String((e && e.message) || e) }); }

// customer-data.js
try { (() => {
(() => {
  const C = [{
    id: "c1",
    name: "Ahmed Hassan",
    tx: [["2026-01-05", "SA_2001", "Sale", "Sales invoice", 48500], ["2026-01-12", "RC_3001", "Payment", "Payment · Cash", 20000], ["2026-01-28", "SA_2008", "Sale", "Sales invoice", 12750], ["2026-02-03", "RC_3002", "Payment", "Payment · Bank Transfer", 30000], ["2026-02-14", "SA_2015", "Sale", "Sales invoice", 36200], ["2026-02-20", "SR_4001", "Return", "Sales return · Damaged unit", 3490], ["2026-03-02", "RC_3003", "Payment", "Payment · Cash · SA_2001", 25000], ["2026-03-18", "SA_2024", "Sale", "Sales invoice", 27400], ["2026-03-25", "RC_3004", "Payment", "Payment · Card", 15000], ["2026-04-06", "SA_2031", "Sale", "Sales invoice", 54900], ["2026-04-15", "RC_3005", "Payment", "Payment · Bank Transfer · SA_2015", 40000], ["2026-04-29", "SR_4002", "Return", "Sales return · Wrong item", 2990], ["2026-05-07", "SA_2040", "Sale", "Sales invoice", 18650], ["2026-05-19", "RC_3006", "Payment", "Payment · Cheque", 20000], ["2026-05-26", "SA_2047", "Sale", "Sales invoice", 31200]]
  }, {
    id: "c2",
    name: "Mona El-Sayed",
    tx: [["2026-03-04", "SA_2019", "Sale", "Sales invoice", 22000], ["2026-03-20", "RC_3011", "Payment", "Payment · Cash", 10000], ["2026-04-10", "SA_2033", "Sale", "Sales invoice", 15800], ["2026-04-22", "RC_3012", "Payment", "Payment · Card · SA_2033", 15800], ["2026-05-12", "SA_2042", "Sale", "Sales invoice", 9400], ["2026-05-18", "SR_4005", "Return", "Sales return · Damaged unit", 1790]]
  }, {
    id: "c3",
    name: "Karim Mostafa",
    tx: [["2026-02-10", "SA_2011", "Sale", "Sales invoice", 67500], ["2026-02-25", "RC_3021", "Payment", "Payment · Bank Transfer", 30000], ["2026-03-30", "RC_3022", "Payment", "Payment · Cheque", 20000], ["2026-04-18", "SA_2036", "Sale", "Sales invoice", 41000], ["2026-05-05", "RC_3023", "Payment", "Payment · Cash", 25000], ["2026-05-22", "SA_2046", "Sale", "Sales invoice", 8900]]
  }, {
    id: "c4",
    name: "Nour Abdelrahman",
    tx: [["2026-01-15", "SA_2004", "Sale", "Sales invoice", 5400], ["2026-01-22", "RC_3031", "Payment", "Payment · Cash · SA_2004", 5400], ["2026-04-02", "SA_2029", "Sale", "Sales invoice", 23300], ["2026-04-30", "RC_3032", "Payment", "Payment · Card", 10000]]
  }, {
    id: "c5",
    name: "Youssef Ibrahim",
    tx: [["2026-03-08", "SA_2022", "Sale", "Sales invoice", 88000], ["2026-03-15", "RC_3041", "Payment", "Payment · Bank Transfer", 50000], ["2026-04-20", "SR_4009", "Return", "Sales return · Wrong item", 5600], ["2026-05-10", "RC_3042", "Payment", "Payment · Cheque", 20000], ["2026-05-27", "SA_2048", "Sale", "Sales invoice", 14250]]
  }];
  const BASE = "2026-11-16";
  const add = (d, n) => {
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  const diff = (a, b) => Math.round((new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 864e5);
  const OFF = [[8, 15, 24], [7, 14, 22, 28], [35, 42, 55], [64, 72, 85], [95, 112, 140]];
  const mk = (names, M, pfx) => {
    let n = 0;
    return names.map((name, i) => ({
      id: pfx + i,
      name,
      invs: M[i].flatMap((out, b) => {
        if (!out) return [];
        const o = OFF[b],
          k = o[i % o.length];
        const due = b === 0 ? add(BASE, k) : add(BASE, -k);
        const paid = (i + b) % 3 === 0 ? Math.round(out * .4 / 500) * 500 : 0;
        n++;
        return [{
          no: (pfx === "c" ? "SA_" : "PU_") + (5000 + n + (pfx === "c" ? 0 : 1000)),
          date: add(due, -30),
          due,
          amount: out + paid,
          paid,
          out
        }];
      })
    }));
  };
  const CUS_AG = mk(["Ahmed Hassan", "Mona El-Sayed", "Karim Mostafa", "Nour Abdelrahman", "Youssef Ibrahim", "Hana Fathy", "Omar Khaled", "Salma Reda", "Mahmoud Adel", "Dina Samir", "Tamer Nabil", "Laila Gamal"], [[60000, 20000, 0, 0, 0], [45000, 0, 12000, 0, 0], [40000, 15000, 0, 5000, 0], [35000, 10000, 8000, 0, 0], [30000, 0, 10000, 0, 5000], [25000, 12000, 0, 7000, 0], [20000, 8000, 0, 0, 0], [20000, 0, 6000, 0, 0], [15000, 10000, 0, 0, 4000], [10000, 0, 4000, 0, 0], [10000, 5000, 0, 8000, 0], [0, 10000, 10000, 0, 6000]], "c");
  const SUP_AG = mk(["China", "Local Supplier", "Delta Supplies", "Nile Cosmetics Trading", "Cairo Packaging Co.", "Alexandria Beauty Imports", "Giza Logistics", "Al-Mansoura Wholesale"], [[70000, 15000, 0, 0, 0], [50000, 0, 10000, 0, 0], [40000, 10000, 0, 0, 3000], [25000, 8000, 0, 5000, 0], [20000, 0, 6000, 0, 0], [10000, 7000, 0, 4000, 0], [10000, 0, 9000, 0, 0], [0, 10000, 0, 3000, 5000]], "s");
  window.AGING = {
    BASE,
    MIN: "2026-10-01",
    MAX: "2026-12-31",
    add,
    diff,
    CUS_AG,
    SUP_AG
  };
  CUS_AG.forEach((a, i) => {
    if (C.some(c => c.name === a.name)) return;
    let k = 0;
    const tx = [];
    a.invs.forEach(v => {
      tx.push([v.date, v.no, "Sale", "Sales invoice", v.amount]);
      if (v.paid > 0) tx.push([add(v.date, 10) > BASE ? BASE : add(v.date, 10), "RC_" + (3200 + i * 10 + ++k), "Payment", "Payment · Cash", v.paid]);
    });
    C.push({
      id: "c" + (C.length + 1),
      name: a.name,
      tx: tx.sort((x, y) => x[0].localeCompare(y[0]))
    });
  });
  const tot = c => {
    let s = 0,
      p = 0,
      r = 0;
    c.tx.forEach(t => {
      if (t[2] === "Sale") s += t[4];else if (t[2] === "Payment") p += t[4];else r += t[4];
    });
    return {
      sales: s,
      paid: p,
      returns: r,
      out: s - p - r
    };
  };
  const all = C.reduce((a, c) => {
    const t = tot(c);
    return {
      sales: a.sales + t.sales,
      paid: a.paid + t.paid,
      returns: a.returns + t.returns,
      out: a.out + t.out
    };
  }, {
    sales: 0,
    paid: 0,
    returns: 0,
    out: 0
  });
  window.CUSTOMERS = C;
  window.CUST_TOTALS = all;
  window.custTotals = tot;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "customer-data.js", error: String((e && e.message) || e) }); }

// demo.js
try { (() => {
(() => {
  const K = "sp.demo.v1";
  try {
    const n = performance.getEntriesByType("navigation")[0];
    if (n && n.type === "reload") sessionStorage.removeItem(K);
  } catch (e) {}
  const P = [["PU_1119", "s1", 4930, "12:25 AM", "2026-05-27"], ["PU_1118", "s1", 2220, "11:58 PM", "2024-02-03"], ["PU_1117", "s1", 162000, "11:50 PM", "2024-02-03"], ["PU_1116", "s1", 45000, "11:42 PM", "2024-02-03"], ["PU_1115", "s1", 49300, "11:23 PM", "2024-02-03"], ["PU_1114", "s1", 64350, "11:15 PM", "2024-02-03"], ["PU_1113", "s1", 30260, "11:12 PM", "2024-02-03"], ["PU_1112", "s1", 1620, "11:02 PM", "2024-02-03"], ["PU_1111", "s1", 95000, "11:08 PM", "2024-02-02"], ["PU_1120", "s2", 12000, "10:10 AM", "2026-05-20"]].map(r => ({
    ref: r[0],
    sup: r[1],
    total: r[2],
    at: r[3],
    date: r[4]
  }));
  const seed = () => ({
    n: 2003,
    suppliers: [{
      id: "s1",
      name: "China",
      email: "china@gmail.com",
      phone: "0155555",
      at: "6:16 AM · 02/02/2024"
    }, {
      id: "s2",
      name: "Local Supplier",
      email: "local@supplier.com",
      phone: "0122222",
      at: "9:00 AM · 15/03/2024"
    }],
    purchases: P,
    payments: [{
      id: "y1",
      ref: "PY_2001",
      date: "2026-05-04",
      sup: "s1",
      method: "Cash",
      amount: 40000,
      txn: "",
      notes: "",
      alloc: [{
        inv: "PU_1111",
        amt: 40000
      }]
    }, {
      id: "y2",
      ref: "PY_2002",
      date: "2026-05-18",
      sup: "s1",
      method: "Bank Transfer",
      amount: 50000,
      txn: "TRX-88231",
      notes: "Second instalment",
      alloc: [{
        inv: "PU_1111",
        amt: 50000
      }]
    }, {
      id: "y3",
      ref: "PY_2003",
      date: "2026-05-27",
      sup: "s1",
      method: "Cash",
      amount: 30000,
      txn: "",
      notes: "Advance payment",
      alloc: []
    }]
  });
  let db;
  try {
    db = JSON.parse(sessionStorage.getItem(K));
  } catch (e) {}
  if (!db) db = seed();
  const save = () => {
    try {
      sessionStorage.setItem(K, JSON.stringify(db));
    } catch (e) {}
    window.dispatchEvent(new Event("sp-demo"));
  };
  const sum = a => a.reduce((s, x) => s + x, 0);
  const D = {
    get: () => db,
    egp: n => "EGP " + (+n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }),
    supplier: id => db.suppliers.find(s => s.id === id),
    supName: id => (D.supplier(id) || {
      name: "—"
    }).name,
    today: () => new Date().toISOString().slice(0, 10),
    addSupplier(f) {
      const id = "s" + Date.now().toString(36);
      const d = new Date();
      const s = {
        id,
        name: f.name.trim(),
        email: f.email.trim(),
        phone: f.phone.trim(),
        at: d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit"
        }) + " · " + d.toLocaleDateString("en-GB")
      };
      db.suppliers = [s, ...db.suppliers];
      save();
      return s;
    },
    paidOn(ref, skip) {
      return sum(db.payments.filter(p => p.id !== skip).flatMap(p => p.alloc).filter(a => a.inv === ref).map(a => a.amt));
    },
    invoice(i, skip) {
      const paid = D.paidOn(i.ref, skip),
        due = Math.max(0, i.total - paid);
      return {
        ...i,
        paid,
        due,
        status: paid <= 0 ? "Unpaid" : due <= 0 ? "Paid" : "Partial"
      };
    },
    invoices(sup, skip) {
      return db.purchases.filter(p => !sup || p.sup === sup).map(p => D.invoice(p, skip));
    },
    payStatus(p) {
      const a = sum(p.alloc.map(x => x.amt));
      return a <= 0 ? "Unallocated" : a >= p.amount ? "Applied" : "Partially Applied";
    },
    allocate(sup, amount, refs, skip) {
      let left = amount;
      const out = [];
      D.invoices(sup, skip).filter(i => refs.includes(i.ref) && i.due > 0).sort((a, b) => a.date.localeCompare(b.date)).forEach(i => {
        const a = Math.min(left, i.due);
        if (a > 0) {
          out.push({
            inv: i.ref,
            amt: a
          });
          left -= a;
        }
      });
      return out;
    },
    savePayment(f, id) {
      const alloc = D.allocate(f.sup, +f.amount, f.refs || [], id);
      const rec = {
        date: f.date,
        sup: f.sup,
        method: f.method,
        amount: +f.amount,
        txn: f.txn,
        notes: f.notes,
        alloc
      };
      if (id) {
        db.payments = db.payments.map(p => p.id === id ? {
          ...p,
          ...rec
        } : p);
      } else {
        db.n += 1;
        db.payments = [{
          id: "y" + db.n,
          ref: "PY_" + db.n,
          ...rec
        }, ...db.payments];
      }
      save();
      return rec;
    },
    deletePayment(id) {
      db.payments = db.payments.filter(p => p.id !== id);
      save();
    },
    txns(sup) {
      const t = [];
      db.purchases.filter(p => p.sup === sup).forEach(p => t.push({
        date: p.date,
        ref: p.ref,
        type: "Purchase",
        desc: "Purchase invoice",
        debit: 0,
        credit: p.total,
        o: 0
      }));
      db.payments.filter(p => p.sup === sup).forEach(p => t.push({
        date: p.date,
        ref: p.ref,
        type: "Payment",
        desc: p.method + (p.alloc.length ? " · applied to " + p.alloc.map(a => a.inv).join(", ") : " · unallocated") + (p.notes ? " · " + p.notes : ""),
        debit: p.amount,
        credit: 0,
        o: 1
      }));
      return t.sort((a, b) => a.date.localeCompare(b.date) || a.o - b.o || a.ref.localeCompare(b.ref));
    },
    flash: m => {
      try {
        sessionStorage.setItem("sp.flash", m);
      } catch (e) {}
    },
    takeFlash() {
      try {
        const m = sessionStorage.getItem("sp.flash");
        sessionStorage.removeItem("sp.flash");
        return m;
      } catch (e) {
        return null;
      }
    }
  };
  window.DEMO = D;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "demo.js", error: String((e && e.message) || e) }); }

// demo.jsx
try { (() => {
(() => {
  const {
      Modal,
      Field,
      Input,
      Button,
      Badge,
      Icon
    } = window.Industry_indust,
    DEMO = window.DEMO;
  function useDemo() {
    const [, f] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
      window.addEventListener("sp-demo", f);
      return () => window.removeEventListener("sp-demo", f);
    }, []);
    return DEMO.get();
  }
  function useToast(initial) {
    const [m, setM] = React.useState(initial || null);
    React.useEffect(() => {
      if (!m) return;
      const t = setTimeout(() => setM(null), 4000);
      return () => clearTimeout(t);
    }, [m]);
    const node = m ? /*#__PURE__*/React.createElement("div", {
      role: "status",
      className: "sp-badge sp-badge--success",
      style: {
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 300,
        height: 44,
        padding: "0 18px",
        fontSize: 14,
        boxShadow: "var(--shadow-lg)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "circle-check",
      size: 18
    }), m) : null;
    return [node, setM];
  }
  const FIELDS = [["name", "Name", "Enter Name"], ["email", "Email", "Enter Email"], ["phone", "Phone Number", "Phone Number"], ["country", "Country", "Enter Country"], ["city", "City", "Enter City"], ["address", "Address", "Enter Address"]];
  function SupplierModal({
    open,
    onClose,
    onSaved
  }) {
    const [f, setF] = React.useState({});
    const [e, setE] = React.useState({});
    React.useEffect(() => {
      if (open) {
        setF({});
        setE({});
      }
    }, [open]);
    const save = () => {
      const n = {};
      FIELDS.forEach(([k, l]) => {
        if (!String(f[k] || "").trim()) n[k] = l + " is required";
      });
      if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) n.email = "Enter a valid email";
      setE(n);
      if (Object.keys(n).length) return;
      const s = DEMO.addSupplier(f);
      onSaved && onSaved(s);
    };
    return /*#__PURE__*/React.createElement(Modal, {
      open: open,
      size: "md",
      title: "Create Supplier",
      onClose: onClose,
      footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
        variant: "secondary",
        onClick: onClose
      }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
        onClick: save
      }, "Save"))
    }, /*#__PURE__*/React.createElement("div", {
      className: "sp-form-grid"
    }, FIELDS.map(([k, l, ph]) => /*#__PURE__*/React.createElement(Field, {
      key: k,
      label: l,
      required: true,
      error: e[k]
    }, /*#__PURE__*/React.createElement(Input, {
      placeholder: ph,
      value: f[k] || "",
      onChange: ev => {
        setF({
          ...f,
          [k]: ev.target.value
        });
        setE({
          ...e,
          [k]: ""
        });
      }
    })))));
  }
  Object.assign(window, {
    useDemo,
    useToast,
    SupplierModal
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "demo.jsx", error: String((e && e.message) || e) }); }

// fin.js
try { (() => {
(() => {
  const K = "sp.fin.v1";
  try {
    const n = performance.getEntriesByType("navigation")[0];
    if (n && n.type === "reload") sessionStorage.removeItem(K);
  } catch (e) {}
  let st;
  try {
    st = JSON.parse(sessionStorage.getItem(K));
  } catch (e) {}
  if (!st || !Array.isArray(st.payments)) st = {
    payments: [],
    n: {
      c: 0,
      s: 0
    }
  };
  const save = () => {
    try {
      sessionStorage.setItem(K, JSON.stringify(st));
    } catch (e) {}
    window.dispatchEvent(new Event("sp-fin"));
  };
  const A = window.AGING,
    sum = a => a.reduce((s, x) => s + x, 0);
  const ACC = [{
    id: "a1",
    name: "Main Cash Register",
    type: "Cash",
    bal: 45000
  }, {
    id: "a2",
    name: "POS Cash Drawer",
    type: "Cash",
    bal: 18250
  }, {
    id: "a3",
    name: "Branch Cash Register",
    type: "Cash",
    bal: 22500
  }, {
    id: "a4",
    name: "CIB Business Account",
    type: "Bank",
    bal: 210000
  }, {
    id: "a5",
    name: "Banque Misr Account",
    type: "Bank",
    bal: 114500
  }];
  const bucket = d => d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
  const dsup = () => window.DEMO ? window.DEMO.get().suppliers : [];
  const FIN = {
    ACC,
    A,
    get: () => st,
    list: kind => st.payments.filter(p => p.kind === kind),
    add(p) {
      if (st.payments.some(x => x.id === p.id)) return {
        dup: true
      };
      if (p.inv) {
        const iv = FIN.openInvoices(p.kind, p.party).find(i => i.ref === p.inv);
        if (!iv || +p.amount > iv.amt) return {
          error: "Exceeds the invoice balance"
        };
      }
      const k = p.kind === "customer" ? "c" : "s";
      st.n[k]++;
      const ref = (k === "c" ? "COL" : "PAY") + "-2026-" + String(st.n[k]).padStart(3, "0");
      const d = new Date();
      const rec = {
        ...p,
        ref,
        amount: +p.amount,
        time: String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
      };
      st.payments = [...st.payments, rec];
      save();
      return {
        rec
      };
    },
    remove(id) {
      st.payments = st.payments.filter(p => p.id !== id);
      save();
    },
    delta: id => sum(st.payments.filter(p => p.acct === id).map(p => p.kind === "customer" ? p.amount : -p.amount)),
    balance: id => ACC.find(a => a.id === id).bal + FIN.delta(id),
    accName: id => (ACC.find(a => a.id === id) || {
      name: "—"
    }).name,
    collected: () => sum(FIN.list("customer").map(p => p.amount)),
    allocOf: (no, asOf) => sum(st.payments.filter(p => p.inv === no && (!asOf || p.date <= asOf)).map(p => p.amount)),
    aging(kind, asOf) {
      const list = kind === "customer" ? A.CUS_AG : A.SUP_AG;
      return list.map(e => {
        const invs = e.invs.filter(i => i.date <= asOf).map(i => {
          const al = FIN.allocOf(i.no, asOf);
          const out = Math.max(0, i.out - al);
          const days = A.diff(asOf, i.due);
          return {
            ...i,
            paid: i.paid + (i.out - out),
            out,
            days: Math.max(0, days),
            b: bucket(days)
          };
        }).filter(i => i.out > 0);
        const bk = [0, 0, 0, 0, 0];
        invs.forEach(i => bk[i.b] += i.out);
        const tot = sum(bk);
        const credit = sum(st.payments.filter(p => p.kind === kind && p.party === e.name && !p.inv && p.date <= asOf).map(p => p.amount));
        return {
          ...e,
          invs,
          bk,
          tot,
          over: tot - bk[0],
          credit
        };
      }).filter(e => e.tot > 0);
    },
    openInvoices(kind, name) {
      const e = FIN.aging(kind, A.BASE).find(x => x.name === name);
      return e ? [...e.invs].sort((a, b) => a.due.localeCompare(b.due)).map(i => ({
        ref: i.no,
        amt: i.out,
        due: i.due
      })) : [];
    },
    parties(kind) {
      if (kind === "customer") return window.CUSTOMERS.map(c => c.name);
      const s = A.SUP_AG.map(x => x.name);
      dsup().forEach(x => {
        if (!s.includes(x.name)) s.push(x.name);
      });
      return s;
    },
    suppTx(name) {
      const ds = dsup().find(x => x.name === name);
      let seed;
      if (ds && window.DEMO) seed = window.DEMO.txns(ds.id);else {
        const e = A.SUP_AG.find(x => x.name === name);
        seed = [];
        if (e) e.invs.forEach(v => {
          seed.push({
            date: v.date,
            ref: v.no,
            type: "Purchase",
            desc: "Purchase invoice",
            debit: 0,
            credit: v.amount,
            o: 0
          });
          if (v.paid > 0) seed.push({
            date: A.add(v.date, 10) > A.BASE ? A.BASE : A.add(v.date, 10),
            ref: "PY_" + (3300 + seed.length),
            type: "Payment",
            desc: "Payment · Cash",
            debit: v.paid,
            credit: 0,
            o: 1
          });
        });
      }
      const dm = FIN.list("supplier").filter(p => p.party === name).map(p => ({
        date: p.date,
        ref: p.ref,
        type: "Payment",
        desc: "Payment · " + p.method + (p.inv ? " · applied to " + p.inv : " · Unallocated") + (p.notes ? " · " + p.notes : ""),
        debit: p.amount,
        credit: 0,
        o: 1,
        demo: true
      }));
      return [...seed, ...dm].sort((a, b) => a.date.localeCompare(b.date) || (a.o || 0) - (b.o || 0) || String(a.ref).localeCompare(String(b.ref)));
    },
    outstanding(kind, name) {
      if (kind === "customer") {
        const c = window.CUSTOMERS.find(x => x.name === name);
        return c ? window.custTotals(c).out - sum(FIN.list("customer").filter(p => p.party === name).map(p => p.amount)) : 0;
      }
      const t = FIN.suppTx(name);
      return sum(t.map(x => x.credit - x.debit));
    },
    partyInfo(kind) {
      return FIN.parties(kind).map(n => ({
        id: n,
        name: n,
        out: FIN.outstanding(kind, n),
        invs: FIN.openInvoices(kind, n).map(i => ({
          ref: i.ref,
          amt: i.amt
        }))
      }));
    },
    cashTx() {
      return st.payments.map(p => ({
        id: p.id,
        ts: p.date + " " + (p.time || "12:00"),
        acct: p.acct,
        kind: p.kind === "customer" ? "D" : "W",
        desc: (p.kind === "customer" ? "Customer Collection — " : "Supplier Payment — ") + p.party,
        amount: p.amount,
        method: p.method,
        purpose: p.kind === "customer" ? "Customer Collection" : "Supplier Payment",
        to: "",
        ref: p.ref,
        status: "Completed",
        notes: p.notes || "",
        party: p.party,
        inv: p.inv || "",
        demo: true
      }));
    }
  };
  window.FIN = FIN;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "fin.js", error: String((e && e.message) || e) }); }

// finui.jsx
try { (() => {
(() => {
  const {
      Modal,
      Field,
      Input,
      Select,
      Textarea,
      Button
    } = window.Industry_indust,
    FIN = window.FIN;
  const egp = n => "EGP " + (+n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  function useFin() {
    const [, f] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
      window.addEventListener("sp-fin", f);
      return () => window.removeEventListener("sp-fin", f);
    }, []);
    return FIN.get();
  }
  function PaymentModal({
    kind,
    open,
    onClose,
    party,
    onSaved
  }) {
    const C = kind === "customer";
    useFin();
    const [f, setF] = React.useState({}),
      [e, setE] = React.useState({}),
      [id, setId] = React.useState(""),
      [done, setDone] = React.useState(false);
    React.useEffect(() => {
      if (open) {
        setId("p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        setF({
          party: party || "",
          date: "2026-05-31",
          amount: "",
          method: "Cash",
          acct: "",
          inv: "",
          txn: "",
          notes: ""
        });
        setE({});
        setDone(false);
      }
    }, [open]);
    const names = FIN.parties(kind),
      inv = f.party ? FIN.openInvoices(kind, f.party) : [],
      out = f.party ? FIN.outstanding(kind, f.party) : null,
      sel = inv.find(i => i.ref === f.inv);
    const set = k => v => {
      setF({
        ...f,
        [k]: v
      });
      setE({
        ...e,
        [k]: ""
      });
    };
    const L = C ? {
      who: "Customer",
      amt: "Amount Collected",
      acct: "Deposit To — Cash / Bank Account",
      inv: "Related Sales Invoice (optional)",
      save: "Save Payment",
      title: "Record Customer Payment",
      bal: "Customer Outstanding Balance"
    } : {
      who: "Supplier",
      amt: "Payment Amount",
      acct: "Pay From — Cash / Bank Account",
      inv: "Related Purchase Invoice (optional)",
      save: "Save Payment",
      title: "Record Supplier Payment",
      bal: "Supplier Outstanding Balance"
    };
    const save = () => {
      if (done) return;
      const n = {};
      if (!f.party) n.party = L.who + " is required";
      if (!f.date) n.date = "Payment date is required";
      if (!(+f.amount > 0)) n.amount = "Enter an amount greater than 0";else if (sel && +f.amount > sel.amt) n.amount = "Exceeds the invoice balance (" + egp(sel.amt) + ")";else if (!C && f.acct && +f.amount > FIN.balance(f.acct)) n.amount = "Insufficient account balance (" + egp(FIN.balance(f.acct)) + ")";
      if (!f.acct) n.acct = "Select an account";
      setE(n);
      if (Object.keys(n).length) return;
      setDone(true);
      const r = FIN.add({
        id,
        kind,
        party: f.party,
        date: f.date,
        amount: +f.amount,
        method: f.method,
        acct: f.acct,
        inv: f.inv,
        txn: f.txn.trim(),
        notes: f.notes.trim()
      });
      onClose();
      if (r.rec && onSaved) onSaved(r.rec);
    };
    return /*#__PURE__*/React.createElement(Modal, {
      open: open,
      size: "md",
      title: L.title,
      onClose: onClose,
      footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
        variant: "secondary",
        onClick: onClose
      }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
        disabled: done,
        onClick: save
      }, L.save))
    }, /*#__PURE__*/React.createElement("div", {
      className: "sp-form-grid"
    }, /*#__PURE__*/React.createElement(Field, {
      label: L.who,
      required: true,
      error: e.party
    }, /*#__PURE__*/React.createElement(Select, {
      placeholder: "Choose " + L.who,
      value: f.party || "",
      onChange: x => setF({
        ...f,
        party: x.target.value,
        inv: ""
      }),
      options: names
    })), /*#__PURE__*/React.createElement(Field, {
      label: "Payment Date",
      required: true,
      error: e.date
    }, /*#__PURE__*/React.createElement(Input, {
      type: "date",
      value: f.date || "",
      onChange: x => set("date")(x.target.value)
    })), f.party && /*#__PURE__*/React.createElement("div", {
      className: "sp-span-all",
      style: {
        background: "var(--neutral-100)",
        borderRadius: "var(--radius-md)",
        padding: "12px 16px",
        display: "flex",
        justifyContent: "space-between",
        font: "400 14px/20px var(--font-body)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-2)"
      }
    }, L.bal), /*#__PURE__*/React.createElement("b", {
      style: {
        color: out > 0 ? "var(--danger-500)" : "var(--text-1)"
      }
    }, egp(out))), /*#__PURE__*/React.createElement(Field, {
      label: L.amt,
      required: true,
      error: e.amount,
      hint: sel ? "Invoice balance: " + egp(sel.amt) : undefined
    }, /*#__PURE__*/React.createElement(Input, {
      type: "number",
      min: "0",
      addon: "EGP",
      placeholder: "0.00",
      value: f.amount || "",
      onChange: x => set("amount")(x.target.value)
    })), /*#__PURE__*/React.createElement(Field, {
      label: "Payment Method"
    }, /*#__PURE__*/React.createElement(Select, {
      value: f.method || "Cash",
      onChange: x => set("method")(x.target.value),
      options: ["Cash", "Bank Transfer", "Card", "Cheque"]
    })), /*#__PURE__*/React.createElement(Field, {
      label: L.acct,
      required: true,
      error: e.acct
    }, /*#__PURE__*/React.createElement(Select, {
      placeholder: "Choose Account",
      value: f.acct || "",
      onChange: x => set("acct")(x.target.value),
      options: FIN.ACC.map(a => ({
        value: a.id,
        label: a.name + " · " + egp(FIN.balance(a.id))
      }))
    })), /*#__PURE__*/React.createElement(Field, {
      label: L.inv
    }, /*#__PURE__*/React.createElement(Select, {
      disabled: !f.party || !inv.length,
      value: f.inv || "",
      onChange: x => set("inv")(x.target.value),
      options: [{
        value: "",
        label: "None (unallocated)"
      }, ...inv.map(i => ({
        value: i.ref,
        label: i.ref + " · " + egp(i.amt)
      }))]
    })), /*#__PURE__*/React.createElement(Field, {
      label: "Payment Reference"
    }, /*#__PURE__*/React.createElement(Input, {
      placeholder: "Enter Reference",
      value: f.txn || "",
      onChange: x => set("txn")(x.target.value)
    })), /*#__PURE__*/React.createElement(Field, {
      label: "Notes",
      className: "sp-span-all"
    }, /*#__PURE__*/React.createElement(Textarea, {
      placeholder: "Enter Notes",
      value: f.notes || "",
      onChange: x => set("notes")(x.target.value)
    }))));
  }
  Object.assign(window, {
    useFin,
    PaymentModal
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "finui.jsx", error: String((e && e.message) || e) }); }

// lock.jsx
try { (() => {
(() => {
  const {
    Modal,
    Field,
    Input,
    Button,
    Switch,
    Icon,
    ConfirmDeleteModal
  } = window.Industry_indust;
  const KEY = "sp.poslock.v1",
    DEF = {
      hash: "",
      salt: "",
      auto: true,
      secs: 30
    };
  const validPin = c => !!c && typeof c.hash === "string" && /^[0-9a-f]{6,64}$/.test(c.hash) && typeof c.salt === "string" && c.salt.length >= 8;
  const load = () => {
    let r = null;
    try {
      r = JSON.parse(localStorage.getItem(KEY));
    } catch (e) {}
    if (!r || typeof r !== "object" || Array.isArray(r)) r = {};
    const c = {
      ...DEF,
      auto: typeof r.auto === "boolean" ? r.auto : DEF.auto,
      secs: Number.isInteger(r.secs) && r.secs >= 15 ? r.secs : DEF.secs
    };
    if (validPin(r)) {
      c.hash = r.hash;
      c.salt = r.salt;
    }
    return c;
  };
  const store = v => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch (e) {}
  };
  const fallback = s => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) >>> 0;
    return h.toString(16);
  };
  async function digest(pin, salt) {
    const t = salt + ":" + pin;
    try {
      if (window.crypto && crypto.subtle) {
        const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
        return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
      }
    } catch (e) {}
    return fallback(t);
  }
  const rnd = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const clean = v => v.replace(/\D/g, "").slice(0, 6);
  const PRESETS = [30, 60, 120, 300];
  function Dots({
    n,
    error
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 10,
        justifyContent: "center",
        margin: "4px 0"
      },
      "aria-hidden": "true"
    }, [0, 1, 2, 3, 4, 5].map(i => /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "2px solid " + (error ? "var(--danger-500)" : "var(--primary-600)"),
        background: i < n ? error ? "var(--danger-500)" : "var(--primary-600)" : "transparent",
        transition: "background .12s"
      }
    })));
  }
  function PinField({
    label,
    value,
    onChange,
    error,
    autoFocus,
    hint
  }) {
    return /*#__PURE__*/React.createElement(Field, {
      label: label,
      required: true,
      error: error,
      hint: hint
    }, /*#__PURE__*/React.createElement(Input, {
      type: "password",
      inputMode: "numeric",
      autoComplete: "off",
      autoFocus: autoFocus,
      placeholder: "4\u20136 digits",
      value: value,
      onChange: e => onChange(clean(e.target.value))
    }));
  }
  function LockOverlay({
    user,
    verify,
    onUnlock
  }) {
    const [pin, setPin] = React.useState("");
    const [err, setErr] = React.useState("");
    const [shake, setShake] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const add = d => {
      setErr("");
      setPin(p => p.length < 6 ? p + d : p);
    };
    const del = () => {
      setErr("");
      setPin(p => p.slice(0, -1));
    };
    const clr = () => {
      setErr("");
      setPin("");
    };
    const submit = async () => {
      if (pin.length < 4) {
        setErr("Enter your 4–6 digit PIN");
        return;
      }
      setBusy(true);
      const ok = await verify(pin);
      setBusy(false);
      if (ok) {
        onUnlock();
      } else {
        setErr("Incorrect PIN. Try again.");
        setPin("");
        setShake(true);
        setTimeout(() => setShake(false), 400);
      }
    };
    const ref = React.useRef();
    ref.current = {
      add,
      del,
      clr,
      submit
    };
    React.useEffect(() => {
      const h = e => {
        const r = ref.current;
        if (/^[0-9]$/.test(e.key)) r.add(e.key);else if (e.key === "Backspace") r.del();else if (e.key === "Delete" || e.key === "Escape") r.clr();else if (e.key === "Enter") r.submit();else if (e.key !== "Tab") return;
        if (e.key !== "Tab") e.preventDefault();
      };
      window.addEventListener("keydown", h, true);
      return () => window.removeEventListener("keydown", h, true);
    }, []);
    const key = {
      height: 60,
      font: "600 22px/1 var(--font-body)",
      background: "#fff",
      color: "var(--text-1)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      transition: "background .12s,transform .08s"
    };
    return /*#__PURE__*/React.createElement("div", {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "POS locked",
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "var(--primary-50)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "sp-lock-in .25s ease"
      }
    }, /*#__PURE__*/React.createElement("style", null, "@keyframes sp-lock-in{from{opacity:0}to{opacity:1}}@keyframes sp-lock-shake{25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}.sp-lockkey:hover{background:var(--primary-100)!important}.sp-lockkey:active{transform:scale(.96)}"), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 380,
        maxWidth: "92vw",
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        padding: "32px 32px 28px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        animation: shake ? "sp-lock-shake .4s" : undefined
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "700 22px/28px var(--font-heading,var(--font-body))",
        color: "var(--primary-700)"
      }
    }, "Sontic Plus"), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 84,
        height: 84,
        borderRadius: "50%",
        background: "var(--primary-100)",
        color: "var(--primary-700)",
        display: "grid",
        placeItems: "center"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "lock",
      size: 40
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("h2", {
      className: "t-section-title",
      style: {
        margin: 0
      }
    }, "POS Locked"), /*#__PURE__*/React.createElement("p", {
      className: "t-body",
      style: {
        margin: "6px 0 0",
        color: "var(--text-2)"
      }
    }, "Enter your PIN to continue"), user && /*#__PURE__*/React.createElement("p", {
      className: "t-caption",
      style: {
        margin: "6px 0 0"
      }
    }, "Signed in as ", user)), /*#__PURE__*/React.createElement(Dots, {
      n: pin.length,
      error: !!err
    }), /*#__PURE__*/React.createElement("div", {
      role: "alert",
      style: {
        minHeight: 20,
        font: "500 13px/20px var(--font-body)",
        color: "var(--danger-500)"
      }
    }, err), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: 10,
        width: "100%"
      }
    }, ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => /*#__PURE__*/React.createElement("button", {
      key: d,
      type: "button",
      className: "sp-lockkey",
      style: key,
      onClick: () => add(d)
    }, d)), /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "sp-lockkey",
      style: {
        ...key,
        font: "600 14px/1 var(--font-body)",
        color: "var(--text-2)"
      },
      onClick: clr
    }, "Clear"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "sp-lockkey",
      style: key,
      onClick: () => add("0")
    }, "0"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "sp-lockkey",
      style: {
        ...key,
        color: "var(--text-2)"
      },
      onClick: del,
      "aria-label": "Delete"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "delete",
      size: 22
    }))), /*#__PURE__*/React.createElement(Button, {
      size: "lg",
      icon: "lock-open",
      disabled: busy || pin.length < 4,
      style: {
        width: "100%"
      },
      onClick: submit
    }, "Unlock")));
  }
  function usePosLock({
    paused
  }) {
    const [cfg, setCfg] = React.useState(load);
    const [locked, setLocked] = React.useState(false);
    const [setup, setSetup] = React.useState(null);
    const [settings, setSettings] = React.useState(false);
    const [change, setChange] = React.useState(false);
    const [rm, setRm] = React.useState(false);
    const [left, setLeft] = React.useState(0);
    const last = React.useRef(Date.now());
    const [secsText, setSecsText] = React.useState(String(load().secs));
    const [secsErr, setSecsErr] = React.useState("");
    const hasPin = validPin(cfg);
    const persist = v => {
      setCfg(v);
      store(v);
    };
    const verify = async p => (await digest(p, cfg.salt)) === cfg.hash;
    const lockNow = () => {
      if (!validPin(load()) || !hasPin) {
        setSetup({
          step: 1,
          a: "",
          b: "",
          err: ""
        });
        return;
      }
      setSettings(false);
      setChange(false);
      setLocked(true);
    };
    const blocked = paused || locked || !!setup || change;
    React.useEffect(() => {
      const bump = () => {
        last.current = Date.now();
      };
      const ev = ["mousemove", "mousedown", "keydown", "touchstart", "wheel", "scroll"];
      ev.forEach(e => window.addEventListener(e, bump, true));
      return () => ev.forEach(e => window.removeEventListener(e, bump, true));
    }, []);
    React.useEffect(() => {
      if (!blocked) last.current = Date.now();
    }, [blocked]);
    React.useEffect(() => {
      if (!hasPin || locked) return;
      const t = setInterval(() => {
        const rem = Math.max(0, cfg.secs * 1000 - (Date.now() - last.current));
        setLeft(Math.ceil(rem / 1000));
        if (cfg.auto && hasPin && !blocked && rem <= 0) {
          setSettings(false);
          setLocked(true);
        }
      }, 500);
      return () => clearInterval(t);
    }, [cfg, hasPin, blocked]);
    const submitSetup = async () => {
      const s = setup;
      if (!/^\d{4,6}$/.test(s.a)) return setSetup({
        ...s,
        step: 1,
        err: "PIN must be 4–6 digits"
      });
      if (s.step === 1) {
        if (s.a.length < 4) return setSetup({
          ...s,
          err: "PIN must be 4–6 digits"
        });
        return setSetup({
          ...s,
          step: 2,
          err: ""
        });
      }
      if (s.b !== s.a) return setSetup({
        ...s,
        err: "PINs do not match. Try again."
      });
      const salt = rnd();
      const hash = await digest(s.a, salt);
      const next = {
        ...cfg,
        hash,
        salt
      };
      if (!validPin(next)) return setSetup({
        ...s,
        err: "Could not save the PIN. Try again."
      });
      persist(next);
      setSetup(null);
      setLocked(true);
    };
    const [cp, setCp] = React.useState({
      cur: "",
      n: "",
      c: "",
      e: {}
    });
    const openChange = () => {
      setCp({
        cur: "",
        n: "",
        c: "",
        e: {}
      });
      setSettings(false);
      setChange(true);
    };
    const saveChange = async () => {
      const e = {};
      if (!cp.cur) e.cur = "Current PIN is required";else if (!(await verify(cp.cur))) e.cur = "Current PIN is incorrect";
      if (cp.n.length < 4) e.n = "New PIN must be 4–6 digits";
      if (cp.c !== cp.n) e.c = "PINs do not match";
      if (Object.keys(e).length) return setCp({
        ...cp,
        e
      });
      const salt = rnd();
      persist({
        ...cfg,
        salt,
        hash: await digest(cp.n, salt)
      });
      setChange(false);
      setSettings(true);
    };
    const commitSecs = t => {
      setSecsText(t);
      const n = +t;
      if (!t || isNaN(n) || n < 15 || !Number.isInteger(n)) {
        setSecsErr("Enter a whole number of at least 15 seconds");
        return;
      }
      setSecsErr("");
      persist({
        ...cfg,
        secs: n
      });
      last.current = Date.now();
    };
    const preset = n => {
      setSecsText(String(n));
      setSecsErr("");
      persist({
        ...cfg,
        secs: n
      });
      last.current = Date.now();
    };
    const node = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Modal, {
      open: !!setup,
      size: "sm",
      title: "Set Up Your POS PIN",
      onClose: () => setSetup(null),
      footer: setup && /*#__PURE__*/React.createElement(React.Fragment, null, setup.step === 2 ? /*#__PURE__*/React.createElement(Button, {
        variant: "secondary",
        onClick: () => setSetup({
          ...setup,
          step: 1,
          b: "",
          err: ""
        })
      }, "Back") : null, /*#__PURE__*/React.createElement(Button, {
        variant: "secondary",
        onClick: () => setSetup(null)
      }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
        onClick: submitSetup
      }, setup.step === 1 ? "Continue" : "Confirm & Lock"))
    }, setup && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("p", {
      className: "t-caption",
      style: {
        margin: 0
      }
    }, "Step ", setup.step, " of 2 \xB7 ", setup.step === 1 ? "Choose a 4–6 digit numeric PIN." : "Enter the PIN again to confirm."), /*#__PURE__*/React.createElement(PinField, {
      key: setup.step,
      autoFocus: true,
      label: setup.step === 1 ? "New PIN" : "Confirm PIN",
      value: setup.step === 1 ? setup.a : setup.b,
      error: setup.err,
      onChange: v => setSetup(setup.step === 1 ? {
        ...setup,
        a: v,
        err: ""
      } : {
        ...setup,
        b: v,
        err: ""
      })
    }), /*#__PURE__*/React.createElement(Dots, {
      n: (setup.step === 1 ? setup.a : setup.b).length
    }), /*#__PURE__*/React.createElement("p", {
      className: "t-caption",
      style: {
        margin: 0
      }
    }, "Demo only. The PIN is kept in this browser as a salted hash."))), /*#__PURE__*/React.createElement(Modal, {
      open: settings,
      size: "sm",
      title: "Lock Settings",
      onClose: () => setSettings(false),
      footer: /*#__PURE__*/React.createElement(Button, {
        variant: "secondary",
        onClick: () => setSettings(false)
      }, "Close")
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 20
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "t-label"
    }, "Security Settings"), /*#__PURE__*/React.createElement(Switch, {
      label: "Auto-Lock",
      checked: cfg.auto,
      onChange: e => persist({
        ...cfg,
        auto: e.target.checked
      })
    }), /*#__PURE__*/React.createElement(Field, {
      label: "Lock After (seconds)",
      required: true,
      error: secsErr,
      hint: "Minimum 15 seconds"
    }, /*#__PURE__*/React.createElement(Input, {
      type: "number",
      min: "15",
      addon: "sec",
      disabled: !cfg.auto,
      value: secsText,
      onChange: e => commitSecs(e.target.value)
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        flexWrap: "wrap"
      }
    }, PRESETS.map(n => /*#__PURE__*/React.createElement("button", {
      key: n,
      type: "button",
      disabled: !cfg.auto,
      className: "pos-chip",
      style: {
        height: 36,
        padding: "0 14px",
        font: "600 13px/1 var(--font-body)",
        opacity: cfg.auto ? 1 : .5
      },
      "aria-pressed": cfg.secs === n,
      onClick: () => preset(n)
    }, n, " sec"))), !hasPin && /*#__PURE__*/React.createElement("div", {
      className: "sp-badge sp-badge--warning",
      style: {
        height: "auto",
        padding: "10px 14px",
        whiteSpace: "normal"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "triangle-alert",
      size: 16
    }), "Set a PIN to activate auto-lock."), hasPin && cfg.auto && /*#__PURE__*/React.createElement("div", {
      className: "t-caption",
      style: {
        background: "var(--neutral-100)",
        borderRadius: "var(--radius-md)",
        padding: "8px 12px"
      }
    }, "Test aid: locks in ", /*#__PURE__*/React.createElement("b", null, Math.max(0, left)), " s without activity (settings stay open, move the mouse to reset)."), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "key-round",
      onClick: hasPin ? openChange : () => {
        setSettings(false);
        setSetup({
          step: 1,
          a: "",
          b: "",
          err: ""
        });
      }
    }, hasPin ? "Change PIN" : "Set Up PIN"), hasPin && /*#__PURE__*/React.createElement(Button, {
      variant: "danger",
      icon: "trash-2",
      onClick: () => {
        setSettings(false);
        setRm(true);
      }
    }, "Remove PIN"))), /*#__PURE__*/React.createElement(ConfirmDeleteModal, {
      open: rm,
      itemType: "POS PIN",
      itemName: "the POS PIN",
      onCancel: () => setRm(false),
      onConfirm: () => {
        persist({
          ...cfg,
          hash: "",
          salt: ""
        });
        setRm(false);
        setSettings(true);
      }
    }), /*#__PURE__*/React.createElement(Modal, {
      open: change,
      size: "sm",
      title: "Change PIN",
      onClose: () => {
        setChange(false);
        setSettings(true);
      },
      footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
        variant: "secondary",
        onClick: () => {
          setChange(false);
          setSettings(true);
        }
      }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
        onClick: saveChange
      }, "Save Changes"))
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement(PinField, {
      autoFocus: true,
      label: "Current PIN",
      value: cp.cur,
      error: cp.e.cur,
      onChange: v => setCp({
        ...cp,
        cur: v,
        e: {
          ...cp.e,
          cur: ""
        }
      })
    }), /*#__PURE__*/React.createElement(PinField, {
      label: "New PIN",
      value: cp.n,
      error: cp.e.n,
      onChange: v => setCp({
        ...cp,
        n: v,
        e: {
          ...cp.e,
          n: ""
        }
      })
    }), /*#__PURE__*/React.createElement(PinField, {
      label: "Confirm New PIN",
      value: cp.c,
      error: cp.e.c,
      onChange: v => setCp({
        ...cp,
        c: v,
        e: {
          ...cp.e,
          c: ""
        }
      })
    }))), locked && /*#__PURE__*/React.createElement(LockOverlay, {
      user: "admin",
      verify: verify,
      onUnlock: () => {
        setLocked(false);
        last.current = Date.now();
      }
    }));
    return {
      lockNow,
      openSettings: () => {
        last.current = Date.now();
        setSecsText(String(cfg.secs));
        setSecsErr("");
        setSettings(true);
      },
      node,
      locked
    };
  }
  window.usePosLock = usePosLock;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "lock.jsx", error: String((e && e.message) || e) }); }

// nav.js
try { (() => {
window.SP_ROUTES = {
  dash: "Dashboard.html",
  p1: "Products.html",
  p2: "Product Categories.html",
  p3: "Brands.html",
  p4: "Units.html",
  p5: "Base Units.html",
  p6: "Print Barcode.html",
  adj: "Adjustments.html",
  quo: "Quotations.html",
  pu1: "Purchases.html",
  pu2: "Purchases Returns.html",
  s1: "Sales.html",
  s2: "Sales Returns.html",
  tr: "Transfers.html",
  e1: "Expenses.html",
  e2: "Expense Categories.html",
  f1: "Cash - Bank Accounts.html",
  f2: "Cash - Bank Transactions.html",
  f3: "Profit - Loss.html",
  f4: "Cash Flow.html",
  f5: "Receivables - Payables Aging.html",
  pe1: "Suppliers.html",
  pe2: "Customers.html",
  pe3: "Users.html",
  pe4: "Supplier Payments.html",
  pe5: "Customer Payments.html",
  ro: "Roles.html",
  wh: "Warehouse.html",
  re: "Warehouse Reports.html",
  cu: "Currencies.html",
  la: "Languages.html",
  t1: "Email Templates.html",
  t2: "SMS Templates.html",
  se: "Settings.html"
};
window.SP_NAV = [{
  id: "dash",
  label: "Dashboard",
  icon: "layout-dashboard"
}, {
  id: "products",
  label: "Products",
  icon: "package",
  children: [{
    id: "p1",
    label: "Products"
  }, {
    id: "p2",
    label: "Product Categories"
  }, {
    id: "p3",
    label: "Brands"
  }, {
    id: "p4",
    label: "Units"
  }, {
    id: "p5",
    label: "Base Units"
  }, {
    id: "p6",
    label: "Print Barcode"
  }]
}, {
  id: "adj",
  label: "Adjustments",
  icon: "sliders-horizontal"
}, {
  id: "quo",
  label: "Quotations",
  icon: "file-text"
}, {
  id: "pur",
  label: "Purchases",
  icon: "receipt",
  children: [{
    id: "pu1",
    label: "Purchases"
  }, {
    id: "pu2",
    label: "Purchases Returns"
  }]
}, {
  id: "sales",
  label: "Sales",
  icon: "shopping-cart",
  children: [{
    id: "s1",
    label: "Sales"
  }, {
    id: "s2",
    label: "Sales Returns"
  }]
}, {
  id: "tr",
  label: "Transfers",
  icon: "arrow-left-right"
}, {
  id: "ex",
  label: "Expenses",
  icon: "wallet",
  children: [{
    id: "e1",
    label: "Expenses"
  }, {
    id: "e2",
    label: "Expense Categories"
  }]
}, {
  id: "fin",
  label: "Finance",
  icon: "landmark",
  children: [{
    id: "f1",
    label: "Cash & Bank Accounts"
  }, {
    id: "f2",
    label: "Cash & Bank Transactions"
  }, {
    id: "f3",
    label: "Profit & Loss"
  }, {
    id: "f4",
    label: "Cash Flow"
  }, {
    id: "f5",
    label: "Receivables & Payables Aging"
  }]
}, {
  id: "pe",
  label: "Peoples",
  icon: "users",
  children: [{
    id: "pe1",
    label: "Suppliers"
  }, {
    id: "pe2",
    label: "Customers"
  }, {
    id: "pe3",
    label: "Users"
  }, {
    id: "pe4",
    label: "Supplier Payments"
  }, {
    id: "pe5",
    label: "Customer Payments"
  }]
}, {
  id: "ro",
  label: "Roles/Permissions",
  icon: "shield-check"
}, {
  id: "wh",
  label: "Warehouse",
  icon: "warehouse"
}, {
  id: "re",
  label: "Reports",
  icon: "chart-column"
}, {
  id: "cu",
  label: "Currencies",
  icon: "circle-dollar-sign"
}, {
  id: "la",
  label: "Languages",
  icon: "languages"
}, {
  id: "te",
  label: "Templates",
  icon: "file",
  children: [{
    id: "t1",
    label: "Email Templates"
  }, {
    id: "t2",
    label: "SMS Templates"
  }]
}, {
  id: "se",
  label: "Settings",
  icon: "settings"
}];
})(); } catch (e) { __ds_ns.__errors.push({ path: "nav.js", error: String((e && e.message) || e) }); }

// tabs.js
try { (() => {
window.SP_REPORT_TABS = [{
  id: "wh",
  label: "Warehouse Reports",
  href: "Warehouse Reports.html"
}, {
  id: "sale",
  label: "Sale Reports",
  href: "Sale Reports.html"
}, {
  id: "stock",
  label: "Stock Reports",
  href: "Stock Reports.html"
}, {
  id: "purchase",
  label: "Purchase Reports",
  href: "Purchase Reports.html"
}, {
  id: "supplier",
  label: "Supplier Statement",
  href: "Supplier Statement.html"
}, {
  id: "customer",
  label: "Customer Statement",
  href: "Customer Statement.html"
}, {
  id: "top",
  label: "Top Selling Products Reports",
  href: "Top Selling Products Reports.html"
}];
window.SP_REPORT_MORE = [{
  id: "cash",
  label: "Cash Report",
  href: "Cash Report.html"
}];
})(); } catch (e) { __ds_ns.__errors.push({ path: "tabs.js", error: String((e && e.message) || e) }); }

// theme.js
try { (() => {
(function () {
  var K = "sp-theme-v1",
    R = document.documentElement,
    used = {};
  var HX = /^#[0-9a-f]{6}$/i,
    PX = /^\d+px$/,
    CK = ["primary", "primaryHover", "accent", "bgApp", "surface", "border", "text1", "text2", "success", "warning", "danger", "info"];
  function apply(v) {
    Object.keys(used).forEach(function (k) {
      R.style.removeProperty(k);
    });
    used = {};
    Object.keys(v || {}).forEach(function (k) {
      R.style.setProperty(k, v[k]);
      used[k] = 1;
    });
  }
  function ok(d) {
    if (!d || typeof d !== "object" || !d.state || !d.vars) return false;
    var s = d.state;
    if (CK.some(function (k) {
      return !HX.test(s[k] || "");
    })) return false;
    if (["Light", "Dark", "System"].indexOf(s.mode) < 0 || ["Default", "Compact"].indexOf(s.sidebar) < 0 || ["Small", "Medium", "Large"].indexOf(s.radius) < 0) return false;
    return Object.keys(d.vars).every(function (k) {
      return /^--[a-z0-9-]+$/.test(k) && (HX.test(d.vars[k]) || PX.test(d.vars[k]));
    });
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(K));
      return ok(d) ? d : null;
    } catch (e) {
      return null;
    }
  }
  window.SPTheme = {
    load: load,
    apply: apply,
    save: function (state, vars) {
      try {
        localStorage.setItem(K, JSON.stringify({
          state: state,
          vars: vars
        }));
        return true;
      } catch (e) {
        return false;
      }
    },
    clear: function () {
      try {
        localStorage.removeItem(K);
      } catch (e) {}
      apply({});
    }
  };
  var d = load();
  if (d) {
    apply(d.vars);
    R.setAttribute("data-sidebar-style", d.state.sidebar.toLowerCase());
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "theme.js", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.Pagination = __ds_scope.Pagination;

__ds_ns.RowMenu = __ds_scope.RowMenu;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.TableToolbar = __ds_scope.TableToolbar;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.FormCard = __ds_scope.FormCard;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.ConfirmDeleteModal = __ds_scope.ConfirmDeleteModal;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.AppShell = __ds_scope.AppShell;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.Sidebar = __ds_scope.Sidebar;

__ds_ns.Topbar = __ds_scope.Topbar;

})();
