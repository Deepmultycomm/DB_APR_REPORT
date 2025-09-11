import React, { useState, useContext, useEffect, useRef } from "react";
import { UserContext } from "../../context/ContextProvider";
import "./TableData.css";

function TableData() {
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [filterName, setFilterName] = useState("");
  const [filterExt, setFilterExt] = useState("");

  const { fetchReport } = useContext(UserContext);
  const firstRun = useRef(true);

  // Load saved filters from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cdrDates") || "null");
      if (saved) {
        setStartDate(saved.startDate || "");
        setStartTime(saved.startTime || "");
        setEndDate(saved.endDate || "");
        setEndTime(saved.endTime || "");
        setFilterName(saved.filterName || "");
        setFilterExt(saved.filterExt || "");
      }
    } catch {}
  }, []);

  const handleFetch = async () => {
    if (!startDate || !endDate || !startTime || !endTime) {
      alert("Please select all date and time fields.");
      return;
    }

    const startDateTime = `${startDate}T${startTime}`;
    const endDateTime = `${endDate}T${endTime}`;

    if (new Date(startDateTime) > new Date(endDateTime)) {
      alert("Start date/time must be earlier than end date/time.");
      return;
    }

    // Save filters to localStorage
    localStorage.setItem(
      "cdrDates",
      JSON.stringify({
        startDate,
        startTime,
        endDate,
        endTime,
        filterName,
        filterExt,
      })
    );

    // Fetch report data
    await fetchReport({
      startDate,
      endDate,
      startTime,
      endTime,
      filterName,
      filterExt,
      fileName: "report.csv",
    });
  };

  return (
   <div className="flt-wrap">
  <div className="flt-row">
    <div className="field">
      <label>Start Date</label>
      <input
        className="inp"
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
      />
    </div>

    <div className="field">
      <label>Start Time</label>
      <input
        className="inp"
        type="time"
        value={startTime}
        onChange={(e) => setStartTime(e.target.value)}
      />
    </div>

    <div className="field">
      <label>End Date</label>
      <input
        className="inp"
        type="date"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
      />
    </div>

    <div className="field">
      <label>End Time</label>
      <input
        className="inp"
        type="time"
        value={endTime}
        onChange={(e) => setEndTime(e.target.value)}
      />
    </div>
  </div>

  <div className="btns">
    <button className="btn primary" onClick={handleFetch}>
      Fetch
    </button>
  </div>
</div>

  );
}

export default TableData;
