import React, { useContext, useState, useEffect, useMemo, useRef } from "react";
import { UserContext } from "../../context/ContextProvider";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Box,
  TextField,
  Stack,
  CircularProgress,
  Button,
  Card,
  CardContent,
  Typography,
} from "@mui/material";
import { formatTs } from "../../utils/Util";

function buildSessions(events) {
  const sessions = [];
  const active = {};

  for (let ev of events) {
    const key = `${ev.type}:${ev.state}`;

    if (ev.enabled === 1 && !active[key]) {
      // Start session
      active[key] = {
        type: ev.type,
        state: ev.state, // <-- always keep the enabled=1 state
        from: ev.ts,
      };
    } else if (ev.enabled === 0 && active[key]) {
      // End session (closing event doesn’t matter, keep start state)
      sessions.push({
        type: active[key].type,
        state: active[key].state,
        from: active[key].from,
        to: ev.ts,
      });
      delete active[key];
    }
  }

  // Handle any still-active sessions
  for (let key in active) {
    sessions.push({
      ...active[key],
      to: null,
    });
  }

  return sessions;
}

export default function GridExample() {
  const { reportData, loading, error, downloadReport } =
    useContext(UserContext);

  console.log("first", reportData);
  const headers = [
    "S.No",
    "Ext",
    "Name",
    "Date",
    "Interval",
    "Login Time",
    "Logoff Time",
    "Total Calls",
    "Answered Calls",
    "Failed Calls",
    "AHT",
    "Available Time",
    "Lunch Time",
    "Tea/Coffee Break",
    "Short Break",
    "Bio Break",
    "Productive Break",
    "Non-Prod. Break",
    "Meeting Time",
    "Chat Time",
    "Tickets Time",
    "Training Time",
    "Other NPT",
    "Outbound Time",
    "Event Details", // ✅ new column
  ];

  const [filterName, setFilterName] = useState("");
  const [filterExt, setFilterExt] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const [debouncedExt, setDebouncedExt] = useState("");
  const [visibleCount, setVisibleCount] = useState(1000);

  const containerRef = useRef(null);

  // Load filters from localStorage
  useEffect(() => {
    const savedFilters = JSON.parse(localStorage.getItem("cdrDates") || "{}");
    setFilterName(savedFilters.filterName || "");
    setFilterExt(savedFilters.filterExt || "");
    setDebouncedName(savedFilters.filterName || "");
    setDebouncedExt(savedFilters.filterExt || "");
  }, []);

  // Save filters
  useEffect(() => {
    localStorage.setItem("cdrDates", JSON.stringify({ filterName, filterExt }));
  }, [filterName, filterExt]);

  // Debounce Name
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedName(filterName), 300);
    return () => clearTimeout(handler);
  }, [filterName]);

  // Debounce Ext
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedExt(filterExt), 300);
    return () => clearTimeout(handler);
  }, [filterExt]);

  // Filtered data
  const filteredData = useMemo(() => {
    return reportData?.filter((row) => {
      const matchName = debouncedName
        ? row.Name?.toLowerCase().includes(debouncedName.toLowerCase())
        : true;
      const matchExt = debouncedExt
        ? row.Ext?.toLowerCase().includes(debouncedExt.toLowerCase())
        : true;
      return matchName && matchExt;
    });
  }, [reportData, debouncedName, debouncedExt]);

  // Reset visible count on filter change
  useEffect(() => {
    setVisibleCount(1000);
  }, [debouncedName, debouncedExt]);

  // Infinite scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 50
      ) {
        setVisibleCount((prev) => prev + 1000);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  if (error)
    return (
      <Box sx={{ p: 2, color: "red" }}>
        Error: No data found for the specified date range.
      </Box>
    );

  return (
    <Box>
      {/* Filter Inputs + Download Button */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          label="Filter by Name"
          variant="outlined"
          size="small"
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
        />
        <TextField
          label="Filter by Ext"
          variant="outlined"
          size="small"
          value={filterExt}
          onChange={(e) => setFilterExt(e.target.value)}
        />

        {/* Push button to right */}
        <Box sx={{ flexGrow: 1 }} />

        <Button
          variant="contained"
          color="success"
          onClick={() => downloadReport("report.csv")}
        >
          ⬇ Download CSV
        </Button>
      </Stack>

      {/* Green Banner */}
      <Box
        sx={{
          backgroundColor: "#8ebb90ff",
          color: "white",
          p: 1.5,
          borderRadius: 1,
          mb: 1,
          fontWeight: "bold",
          textAlign: "center",
          fontSize: "1rem",
          boxShadow: 2,
        }}
      >
        📊 Total Records: {filteredData?.length || 0}
      </Box>

      <TableContainer
        ref={containerRef}
        component={Paper}
        sx={{ maxHeight: "75vh", borderRadius: 2, overflow: "auto" }}
      >
        <Table
          stickyHeader
          size="small"
          sx={{
            border: "1px solid #d0d0d0",
            borderCollapse: "separate",
            borderSpacing: 0,
            "& th, & td": {
              border: "1px solid #d0d0d0",
              minWidth: 120,
              padding: "10px 12px",
              fontSize: "13px",
              whiteSpace: "nowrap",
              verticalAlign: "top",
            },
          }}
        >
          <TableHead>
            <TableRow>
              {headers.map((h) => (
                <TableCell
                  key={h}
                  sx={{
                    fontWeight: 700,
                    backgroundColor: "#666363f5",
                    color: "#fff",
                    textAlign: "center",
                  }}
                >
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={headers.length}
                  sx={{ textAlign: "center" }}
                >
                  <CircularProgress />
                </TableCell>
              </TableRow>
            )}

            {!loading && filteredData && filteredData.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={headers.length}
                  sx={{ textAlign: "center" }}
                >
                  No data found.
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              filteredData &&
              filteredData.slice(0, visibleCount).map((row, idx) => (
                <TableRow
                  key={idx}
                  sx={{
                    "&:nth-of-type(odd)": { bgcolor: "#fafafa" },
                    "&:hover": { bgcolor: "#f0f5ff" },
                  }}
                >
                  {/* Serial Number */}
                  <TableCell sx={{ textAlign: "center", fontWeight: 600 }}>
                    {idx + 1}
                  </TableCell>

                  {/* Data Columns (excluding Event Details) */}
                  {headers.slice(1, -1).map((h) => (
                    <TableCell key={h} sx={{ textAlign: "center" }}>
                      {row[h] ?? "-"}
                    </TableCell>
                  ))}

                  {/* Event Details column */}
                  <TableCell sx={{ minWidth: 320, maxWidth: 520 }}>
                    <Box
                      sx={{
                        display: "flex",
                        gap: 2,
                        overflowX: "auto",
                        pb: 1,
                      }}
                    >
                      {(() => {
                        let events = [];
                        try {
                          if (row["Event Details"]) {
                            events = JSON.parse(row["Event Details"]);
                          }
                        } catch (e) {
                          console.error("Invalid Event Details JSON:", e);
                        }

                        // build sessions (start = enabled=1, end = enabled=0)
                        const sessions = [];
                        let active = {};
                        for (let ev of events) {
                          const key = `${ev.type}:${ev.state}`;
                          if (ev.enabled === 1 && !active[key]) {
                            active[key] = { ...ev };
                          } else if (ev.enabled === 0 && active[key]) {
                            sessions.push({
                              ...active[key],
                              to: ev.ts,
                            });
                            delete active[key];
                          }
                        }
                        // keep still-active sessions
                        for (let k in active) {
                          sessions.push({
                            ...active[k],
                            to: null,
                          });
                        }

                        // filter out "none"
                        const filtered = sessions.filter(
                          (s) => s.state !== "none"
                        );

                        return filtered.length > 0 ? (
                          filtered.map((ev, i) => (
                            <Card
                              key={i}
                              sx={{
                                minWidth: 220,
                                flexShrink: 0,
                                borderRadius: 3,
                                border: "2px solid #4caf50", // success green border
                                boxShadow: "0px 4px 12px rgba(0,0,0,0.08)",
                                bgcolor: "white",
                                transition: "all 0.2s ease",
                                "&:hover": {
                                  boxShadow: "0px 6px 16px rgba(0,0,0,0.12)",
                                },
                              }}
                            >
                              <CardContent sx={{ p: 2 }}>
                                {/* <Typography
                                  variant="subtitle1"
                                  sx={{ fontWeight: 700, color: "#388e3c" }}
                                >
                                  {ev.type}
                                </Typography> */}
                                <Typography
                                  variant="body2"
                                  sx={{ color: "text.primary" }}
                                >
                                  State: <b>{ev.state}</b>
                                </Typography>
                                <Typography
                                  variant="body2"
                                  sx={{ color: "text.secondary" }}
                                >
                                  From: {formatTs(ev.ts)}
                                </Typography>
                                <Typography
                                  variant="body2"
                                  sx={{ color: "text.secondary" }}
                                >
                                  To: {ev.to ? formatTs(ev.to) : "Active"}
                                </Typography>
                                {/* <Typography
                                  variant="caption"
                                  sx={{
                                    color: "text.disabled",
                                    display: "block",
                                    mt: 1,
                                  }}
                                >
                                  {ev.name} ({ev.ext})
                                </Typography> */}
                              </CardContent>
                            </Card>
                          ))
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            No valid events
                          </Typography>
                        );
                      })()}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
