import { render } from "solid-js/web";
import App from "./App";
import "./app.css";

// Register web components before rendering
import "./web-components/ve-panel";
import "./web-components/ve-panel-layout";

render(() => <App />, document.getElementById("root")!);
