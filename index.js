import express from "express";
import bodyParser from "body-parser";
import pg from "pg";

const app = express();
const port = 3000;

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "studynotes",
  password: process.env.DATABASE_PASSWORD,
  port: 5432,
});
db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
// app.use(express.static("public"));

/* https://github.com/brianc/node-postgres/issues/957#issuecomment-426852393 */
// expand(3, 2) returns "($1, $2), ($3, $4), ($5, $6)" 
function expand(rowCount, columnCount, startAt = 1) {
    var index = startAt;
    return Array(rowCount)
        .fill(0)
        .map(
        (v) =>
            `(${Array(columnCount)
            .fill(0)
            .map((v) => `$${index++}`)
            .join(", ")})`
        )
        .join(", ");
}
  
// flatten([[1, 2], [3, 4]]) returns [1, 2, 3, 4]
function flatten(arr) {
    var newArr = [];
    arr.forEach((v) => v.forEach((p) => newArr.push(p)));
    return newArr;
}

async function getCategories() {
    const result = await db.query("SELECT id, title FROM category ORDER BY title ASC");
    // TODO: just return the result, no need to loop?
    let categories = [];
    result.rows.forEach((category) => {
        categories.push(category);
    });
    return categories;
}

app.get("/", async (req, res) => {
    let data = [];
    try {
        const result = await db.query("SELECT id,title,description,created_date,reference_url FROM note ORDER BY id DESC");
        if (result.rows.length > 0) {
            data = result.rows;
        }
        res.render("index.ejs", { activeNav: "home", notes: data });
    } catch(err) {
        console.error(err);
    }
});

/* Note routes */
app.get("/add-note", async (req, res) => {
    const data = await getCategories();
    res.render("add-note.ejs", { activeNav: "home", categories: data });
});

app.post("/submit-note", async (req, res) => {
    const title = req.body.title.trim();
    const description = req.body.description;
    const quizKeyword = req.body.quizKeyword.trim();
    const referenceUrl = req.body.referenceUrl.trim();
    const date = new Date();
    const formattedDate = date.toISOString().slice(0, 10);
    const selectedCategories = (typeof req.body.categories === 'string') ? [req.body.categories] : req.body.categories;
    try {
        const result = await db.query("INSERT INTO note (title, description, quiz_keyword, reference_url, created_date) VALUES ($1, $2, $3, $4, $5) RETURNING id", [title, description, quizKeyword, referenceUrl, formattedDate]);
        const newRecordId = result.rows[0].id;
        let categoryItemsToAddArr = [];
        if (selectedCategories.length) {
            selectedCategories.forEach(c => {
                categoryItemsToAddArr.push([parseInt(c), parseInt(newRecordId)]);
            });
        }
        // Create category item records based on selected
        await db.query(`INSERT INTO category_item (category_id, note_id) VALUES ${expand(categoryItemsToAddArr.length, 2)}`, flatten(categoryItemsToAddArr));
        res.redirect("/");
    } catch(err) {
        console.error(err);
    }
});

app.get("/edit-note/:id", async (req, res) => {
    const noteId = req.params.id;
    const allCategoryData = await getCategories();
    let noteData = [];
    let selectedCategoryData = [];
    try {
        const noteResult = await db.query("SELECT id, title, description, quiz_keyword, reference_url FROM note WHERE id = $1", [noteId]);
        if (noteResult.rows.length != 0) {
            noteData = noteResult.rows[0];
        }
        // Get all categories and selected category data
        const categoriesResult = await db.query("SELECT category_id, note_id FROM category_item WHERE note_id = $1", [noteId]);
        if (categoriesResult.rows.length > 0) {
            selectedCategoryData = categoriesResult.rows;
        }
    } catch(err) {
        console.error(err);
    }
    res.render("edit-note.ejs", { activeNav: "home", note: noteData, allCategories: allCategoryData, selectedCategories: selectedCategoryData });
});

app.post("/save-note", async (req, res) => {
    const noteId = parseInt(req.body.noteId);
    const title = req.body.title.trim();
    const description = req.body.description;
    const quizKeyword = req.body.quizKeyword.trim();
    const referenceUrl = req.body.referenceUrl.trim();
    const date = new Date();
    const formattedDate = date.toISOString().slice(0, 10);
    const selectedCategories = (typeof req.body.categories === 'string') ? [req.body.categories] : req.body.categories;
    try {
        await db.query("UPDATE note SET title = $1, description = $2, quiz_keyword = $3, reference_url = $4, modified_date = $5 WHERE id = $6", [title, description, quizKeyword, referenceUrl, formattedDate, noteId]);
        // ON EDIT the note is always going to have at least one existing category item
            // and at least one selected category to save
            // because the category field is required on the front-end
        const pruneResults = await db.query("SELECT category_id FROM category_item WHERE note_id = $1", [noteId]);
        const pruneData = pruneResults.rows;
        const deleteSet = [];
        let categoryItemsToAddArr = [];
            
        // If Some category item records already exist for this note, check with newly selected
        if (pruneData.length) {
            pruneData.forEach(pd => {
                const pdCatId = parseInt(pd.category_id);
                const found = selectedCategories.find((c) => parseInt(c) === pdCatId);
                if (found === undefined) {
                    // Add this item to a collection to delete next, because
                        // it is no longer selected for the note
                    deleteSet.push(pdCatId);
                }
            });
        } else {
            console.log('No selected categories conflict with existing category item data for this note.');
        }
        if (deleteSet.length) {
            await db.query("DELETE FROM category_item WHERE category_id = ANY($1) AND note_id = $2",[deleteSet, noteId]);
        }
        // Now create the collection of category IDs that need to be associated with this note
            // minus the ones that already exist
        if (selectedCategories.length) {
            selectedCategories.forEach(c => {
                const catId = parseInt(c);
                const found = pruneData.find((pd) => parseInt(pd.category_id) === catId);
                if (found === undefined) {
                    categoryItemsToAddArr.push([catId, noteId]);
                }
            });
            // Create new category item records based on selected
            if (categoryItemsToAddArr.length) {
                await db.query(`INSERT INTO category_item (category_id, note_id) VALUES ${expand(categoryItemsToAddArr.length, 2)}`, flatten(categoryItemsToAddArr));
            }
            res.redirect("/");
        } else {
            console.error('There should be a selected category for this note.');
        }
    } catch(err) {
        console.error(err);
    }
});

app.post("/delete-note", async (req, res) => {
    const noteId = req.body.noteId;

    // Delete category items with note_id
    try {
        await db.query("DELETE FROM category_item WHERE note_id = $1", [noteId]);
    } catch(err) {
        console.error(err);
    }
    
    // Delete quiz items with note_id
    try {
        await db.query("DELETE FROM quiz_item WHERE note_id = $1", [noteId]);
    } catch(err) {
        console.error(err);
    }

    // Delete note after related records are deleted
    try {
        await db.query("DELETE FROM note WHERE id = $1", [noteId]);
        res.redirect("/");
    } catch(err) {
        console.error(err);
    }
});

/* Category routes */

app.get("/categories", async (req, res) => {
    const data = await getCategories();
    res.render("categories.ejs", { activeNav: "categories", categories: data });
});

app.get("/add-category", async (req, res) => {
    res.render("add-category.ejs", { activeNav: "categories" });
});

app.post("/submit-category", async (req, res) => {
    const categoryTitle = req.body.title.trim();
    try {
        await db.query("INSERT INTO category (title) VALUES ($1)",[categoryTitle]);
        res.redirect('/categories')
    } catch(err) {
        res.render('add-category.ejs', { activeNav: "categories", error: err.detail })
    }
});

app.get("/edit-category/:id", async (req, res) => {
    let data = [];
    try {
        const result = await db.query("SELECT id, title FROM category WHERE id = $1", [req.params.id]);
        if (result.rows.length != 0) {
            data = result.rows[0];
        }
    } catch(err) {
        console.error(err);
    }
    res.render("edit-category.ejs", { activeNav: "categories", category: data });
});

app.post("/save-category", async (req, res) => {
    const categoryTitle = req.body.title.trim();
    try {
        await db.query("UPDATE category SET title = $1 WHERE id = $2",[categoryTitle, req.body.categoryId]);
        res.redirect("/categories");
    } catch(err) {
        console.error(err);
    }
});

app.post("/delete-category", async (req, res) => {
    const catId = parseInt(req.body.categoryId);
    // Delete category items records before deleting category
    try {
        await db.query("DELETE FROM category_item WHERE category_id = $1", [catId]);
    } catch(err) {
        console.error(err);
    }
    // Delete category record after all related records are deleted
    try {
        await db.query("DELETE FROM category WHERE id = $1", [catId]);
        res.redirect("/categories");
    } catch(err) {
        console.error(err);
    }
});

app.get("/category/:id", async (req,res) => {
    const catId = parseInt(req.params.id);
    let data = [];
    let categoryTitle = '';

    // Get category title
    try {
        const categoryResult = await db.query("SELECT title FROM category WHERE id = $1", [catId]);
        if (categoryResult.rows.length !== 0) {
            categoryTitle = categoryResult.rows[0].title;
        }
    } catch(err) {
        console.error(err);
    }

    // Get category notes
    try {
        const result = await db.query("SELECT note.title, note.reference_url, note.created_date, note.description, category_item.note_id FROM category_item JOIN note ON note.id = category_item.note_id WHERE category_item.category_id = $1 ORDER BY note.id DESC", [catId]);
        if (result.rows.length > 0) {
            data = result.rows;
        }
        res.render("category.ejs", { activeNav: "categories", title: categoryTitle, notes: data });
    } catch(err) {
        console.error(err);
    }
});

/* Quiz routes */

app.get("/quizzes", async (req, res) => {
    res.render("quizzes.ejs", { activeNav: "quizzes" });
});

app.get("/add-quiz", async (req, res) => {
    res.render("add-quiz.ejs", { activeNav: "quizzes" });
});

app.post("/submit-quiz", (req, res) => {
    res.render("quizzes.ejs", { activeNav: "quizzes" });
});

app.get("/edit-quiz", (req, res) => {
    res.render("edit-quiz.ejs", { activeNav: "quizzes" });
});

app.post("/save-quiz", (req, res) => {
    res.render("quizzes.ejs", { activeNav: "quizzes" });
});

app.post("/delete-quiz", (req, res) => {
    console.log('delete quiz');
    res.render("quizzes.ejs", { activeNav: "quizzes" });
});

/* Search routes */

app.post("/search", async (req, res) => {
    res.render("search.ejs");
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
