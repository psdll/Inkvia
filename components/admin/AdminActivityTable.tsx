"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react";
import styles from "./admin-activity.module.css";

type Cell = {
  value: string | number;
  display?: string;
  color?: string;
  share?: number;
  action?: () => void;
};
type Column = { key: string; label: string; numeric?: boolean };
export default function AdminActivityTable({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: Column[];
  rows: { key: string; cells: Record<string, Cell> }[];
}) {
  const { label: uiLabel, locale: uiLocale } = useUiLocale();
  const [sort, setSort] = React.useState<{
    key: string;
    ascending: boolean;
  } | null>(null);
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const left = a.cells[sort.key]?.value ?? "",
          right = b.cells[sort.key]?.value ?? "";
        return (
          (typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right), "zh-CN")) *
          (sort.ascending ? 1 : -1)
        );
      })
    : rows;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{ textAlign: column.numeric ? "right" : "left" }}
                aria-sort={
                  sort?.key === column.key
                    ? sort.ascending
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  onClick={() =>
                    setSort({
                      key: column.key,
                      ascending:
                        sort?.key === column.key
                          ? !sort.ascending
                          : !column.numeric,
                    })
                  }
                >
                  {uiLabel(column.label)}
                  {sort?.key !== column.key ? (
                    <ArrowDownUp size={12} />
                  ) : sort.ascending ? (
                    <ArrowUp size={12} />
                  ) : (
                    <ArrowDown size={12} />
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.key}>
              {columns.map((column) => {
                const cell = row.cells[column.key];
                const text =
                  cell?.display ??
                  (typeof cell?.value === "number"
                    ? cell.value.toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN")
                    : (cell?.value ?? "—"));
                return (
                  <td
                    key={column.key}
                    style={{ textAlign: column.numeric ? "right" : "left" }}
                  >
                    <div
                      className={
                        column.numeric ? styles.share : styles.tableName
                      }
                    >
                      {cell?.color && !column.numeric && (
                        <i
                          className={styles.dot}
                          style={{ background: cell.color }}
                        />
                      )}
                      {cell?.share != null && (
                        <span className={styles.shareTrack}>
                          <i
                            style={{
                              width: `${Math.max(0, Math.min(1, cell.share)) * 100}%`,
                              background: cell.color || ACTIVITY_DEFAULT,
                            }}
                          />
                        </span>
                      )}
                      {cell?.action ? (
                        <button
                          className={styles.cellLabel}
                          title={String(text)}
                          onClick={cell.action}
                        >
                          {text}
                        </button>
                      ) : (
                        <span
                          className={
                            column.numeric ? undefined : styles.cellLabel
                          }
                          title={String(text)}
                        >
                          {text}
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          {!sorted.length && (
            <tr>
              <td colSpan={columns.length}><UiText id="admin.m497c85690c4c" /></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
const ACTIVITY_DEFAULT = "#0090ff";
