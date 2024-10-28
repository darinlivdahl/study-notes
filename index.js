import express from "express";
import bodyParser from "body-parser";
// import pg from "pg";

const app = express();
const port = 3000;

// const db = new pg.Client({
//   user: "postgres",
//   host: "localhost",
//   database: "world",
//   password: "", // TODO: USE ENVIRONMENT VARIABLE
//   port: 5432,
// });
// db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.get("/", async (req, res) => {
  const users = await getUsers();
  const countries = await checkVisisted(currentUserId);
  const userColor = users.filter((u) => u.id == currentUserId)[0].color;
  res.render("index.ejs", {
    countries: countries,
    total: countries.length,
    users: users,
    color: userColor,
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
