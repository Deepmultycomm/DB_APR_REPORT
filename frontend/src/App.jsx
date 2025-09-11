// import "./App.css";
import { Container } from "@mui/material";
import GridExample from "./components/Grid/GridExample";
import TableData from "./components/TableData/TableData";
import AllGrid from "./components/Grid/AllGrid";
import Header from "./components/headers/Header";
function App() {

  return (
  
    <>
      <Container maxWidth='100%'>
        <Header/>
        <TableData />
        <GridExample />
      </Container>
    </>
  );
}

export default App;
