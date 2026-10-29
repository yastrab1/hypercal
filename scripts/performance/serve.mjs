import express from "express";
const app = express();
for (const build of ["baseline", "current"])
  app.use(
    `/${build}`,
    express.static(`artifacts/performance/${build}`, { index: false }),
  );
app.listen(5174, "127.0.0.1", () =>
  console.log(
    "Performance fixtures: http://localhost:5174/{baseline,current}/scripts/performance/index.html",
  ),
);
