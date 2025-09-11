import {getReportData} from './generateReport.js';


const x=getReportData('2024-08-09 06:00:00','2024-08-09 12:00:00');
x.then((data)=>{
    console.log("final Data coming",data);  }).catch((err)=>{
    console.error(err);});