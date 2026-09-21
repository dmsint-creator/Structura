import type { Metadata } from "next";
import "./globals.css";
import "./readability.css";
import "./final.css";
import "./brand.css";
import "./org-chart.css";
export const metadata: Metadata = { title:"Corporate Group Structure Manager", description:"Maintain legal entities, ownership records and professional corporate group structure charts.", icons:{icon:"/favicon.svg"} };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
