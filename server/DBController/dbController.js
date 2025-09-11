import {fetchAPRData,fetchAgentStatusData} from "../Collecetions/fetchAPIToMergeData.js";

const agent_events = await fetchAPRData("1755678600", "1755693000");
const users_calls = await fetchAgentStatusData("1755678600", "1755693000");

console.log("agent_events:", agent_events);
console.log("users_calls:", users_calls);