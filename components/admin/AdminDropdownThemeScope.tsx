"use client";

import * as React from "react";

export function AdminDropdownThemeScope() {
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-admin-dropdown-scope");
    root.setAttribute("data-admin-dropdown-scope", "true");

    return () => {
      if (previous === null) {
        root.removeAttribute("data-admin-dropdown-scope");
      } else {
        root.setAttribute("data-admin-dropdown-scope", previous);
      }
    };
  }, []);

  return null;
}
