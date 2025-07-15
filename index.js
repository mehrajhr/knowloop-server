const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// DB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.a0ni9sf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();

    const db = client.db("knowloop");
    const usersCollection = db.collection("users");
    const sessionsCollection = db.collection("studySessions");

    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const email = user.email;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          await usersCollection.updateOne(
            { email },
            { $set: { last_login: new Date().toISOString } }
          );
          return res
            .status(200)
            .json({ message: "User already exists", updated: true });
        }

        const result = await usersCollection.insertOne(user);
        return res
          .status(201)
          .json({ message: "New user created", insertedId: result.insertedId });
      } catch (error) {
        console.error("Error saving user:", error);
        return res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/sessions", async (req, res) => {
      try {
        const sessions = await sessionsCollection
          .find()
          .sort({ registrationStartDate: 1 }) // optional: sort by date ascending
          .toArray();

        res.send(sessions);
      } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ message: "Failed to fetch study sessions" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.error(error);
  }
}
run();

app.get("/", async (req, res) => {
  res.send("know loop server running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
