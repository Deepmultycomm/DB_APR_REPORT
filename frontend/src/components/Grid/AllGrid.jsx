import React, { useContext, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from "@mui/material";
import { UserContext } from "../../context/ContextProvider";
// import { mergeAgentData } from "../../utils/Util"; // your helper
// import "./AllGrid.css"; // CSS file

function AllGrid() {
  const { cdrData, agentStatusData } = useContext(UserContext);

  // const mergedData = useMemo(
  //   () => mergeAgentData(cdrData, agentStatusData),
  //   [cdrData, agentStatusData]
  // );

  return (
    <TableContainer component={Paper} sx={{ mt: 2 }}>
      <Table className="crm-table">
        <TableHead>
          <TableRow>
            <TableCell><b>Ext</b></TableCell>
            <TableCell><b>Name</b></TableCell>
            <TableCell><b>Total Calls</b></TableCell>
            <TableCell><b>Answered</b></TableCell>
            <TableCell><b>Idle Time</b></TableCell>
            <TableCell><b>Not Available Time</b></TableCell>
            <TableCell><b>On Call Time</b></TableCell>
            <TableCell><b>Wrap Up Time</b></TableCell>
            <TableCell><b>CDR Events</b></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {mergedData.map((row, idx) => (
            <TableRow key={idx} className="crm-row">
              <TableCell>{row.ext}</TableCell>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.statusData.total_calls ?? "-"}</TableCell>
              <TableCell>{row.statusData.answered_calls ?? "-"}</TableCell>
              <TableCell>{row.statusData.idle_time ?? "-"}</TableCell>
              <TableCell>{row.statusData.not_available_time ?? "-"}</TableCell>
              <TableCell>{row.statusData.on_call_time ?? "-"}</TableCell>
              <TableCell>{row.statusData.wrap_up_time ?? "-"}</TableCell>
              <TableCell
                onDragOver={(ev) => ev.preventDefault()}
                onDrop={(ev) => {
                  const data = ev.dataTransfer.getData("text/plain");
                  console.log("Dropped event:", data, "on row", row.ext);
                  // TODO: handle state update if you want to move events
                }}
              >
                {row.cdrEvents.length > 0 ? (
                  <div className="cdr-events-container">
                    {row.cdrEvents.map((e, i) => (
                      <div
                        key={i}
                        className={`cdr-event-card ${e.event}`}
                        draggable="true"
                        onDragStart={(ev) =>
                          ev.dataTransfer.setData("text/plain", e.event)
                        }
                      >
                        <strong>{e.event}</strong>{" "}
                        ({e.enabled ? "✔" : "✖"})
                        <span className="cdr-event-timestamp">{e.Timestamp}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  "-"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default AllGrid;
