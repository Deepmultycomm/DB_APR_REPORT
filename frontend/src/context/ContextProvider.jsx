import React, { createContext, useState } from "react";
import axios from "axios";
import Papa from "papaparse";

export const UserContext = createContext();

const BASE_URL = `${import.meta.env.VITE_API_BASE}/api/report`;

function ContextProvider({ children }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [reportData, setReportData] = useState(null); // full rows (with events)
  const [cleanData, setCleanData] = useState(null);   // stripped rows (no events)

  // 1) Fetch CSV
  const fetchReport = async ({ startDate, endDate, startTime, endTime }) => {
    try {
      setLoading(true);
      setError(null);

      // Build query parameters
      const params = { startDate };
      if (endDate) params.endDate = endDate;
      if (startTime) params.startTime = startTime;
      if (endTime) params.endTime = endTime;

      // Fetch CSV
      const response = await axios.get(BASE_URL, {
        params,
        responseType: "blob",
      });

      // Read CSV text
      const blob = response.data;
      const csvText = await blob.text();

      // Parse CSV into JSON rows
      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
      });

      // Save full rows (with Event Details) for table
      setReportData(parsed.data);

      // Build a clean dataset (strip Event Details) for CSV download
      const stripped = parsed.data.map((row) => {
        const copy = { ...row };
        delete copy["Event Details"];
        return copy;
      });
      setCleanData(stripped);

    } catch (err) {
      console.error("Error fetching report:", err);
      setError(err?.response || err);
      setReportData(null);
      setCleanData(null);
    } finally {
      setLoading(false);
    }
  };

  // 2) Download CSV (without Event Details)
  const downloadReport = (fileName = "report.csv") => {
    if (!cleanData) {
      alert("Please fetch the data first before downloading.");
      return;
    }
    const csv = Papa.unparse(cleanData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <UserContext.Provider
      value={{
        fetchReport,
        downloadReport,
        loading,
        error,
        reportData, // ✅ full rows (with Event Details) for table UI
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export default ContextProvider;
