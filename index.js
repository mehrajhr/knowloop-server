const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require("mongodb");

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
    const bookedSessionsCollection = db.collection("bookedSessions");
    const notesCollection = db.collection("notes");

    // for useres

    // get user
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

    // create user
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

    // for sessions

    // get all sessions which approved by admin
    app.get("/sessions", async (req, res) => {
      const status = req.query.status;
      const query = { status: status ? status : "approved" };
      try {
        if (status === "all") {
          const sessions = await sessionsCollection
            .find()
            .sort({ registrationStartDate: 1 })
            .toArray();

          res.send(sessions);
        } else {
          const sessions = await sessionsCollection
            .find(query)
            .sort({ registrationStartDate: 1 }) // optional: sort by date ascending
            .toArray();

          res.send(sessions);
        }
      } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ message: "Failed to fetch study sessions" });
      }
    });

    // get session by id for details
    app.get("/sessions/:id", async (req, res) => {
      try {
        const sessionId = req.params.id;

        // Validate ObjectId
        if (!ObjectId.isValid(sessionId)) {
          return res.status(400).json({ message: "Invalid session ID" });
        }

        const session = await sessionsCollection.findOne({
          _id: new ObjectId(sessionId),
        });

        if (!session) {
          return res.status(404).json({ message: "Study session not found" });
        }

        res.send(session);
      } catch (error) {
        console.error("Error fetching session by ID:", error);
        res.status(500).json({ message: "Failed to fetch session" });
      }
    });

    // post or create session by teacher
    app.post("/study-sessions", async (req, res) => {
      try {
        const session = req.body;

        // Ensure fee and status have default values
        session.fee = session.fee || "0";
        session.status = "pending";
        session.reviews = [];
        session.averageRating = 0;

        const result = await sessionsCollection.insertOne(session);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("Error creating session:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to create session" });
      }
    });

    // use by admin for sessions

    // sessions delete by admin
    app.delete("/sessions/:id", async (req, res) => {
      const id = req.params.id;
      const result = await sessionsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // update price by admin 
    app.patch("/sessions/:id", async (req, res) => {
      const id = req.params.id;
      const { price } = req.body;

      try {
        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { fee: price } }
        );

        res.send(result);
      } catch (error) {
        console.error("Failed to update session price:", error);
        res.status(500).json({ message: "Update failed" });
      }
    });

    // set fees by admin
    app.patch("/sessions/approve/:id", async (req, res) => {
      const { id } = req.params;
      const { fee, status } = req.body;
      const result = await sessionsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { fee, status } }
      );
      res.send({ success: result.modifiedCount > 0 });
    });

    // Reject session by admin
    app.patch("/sessions/reject/:id", async (req, res) => {
      const { id } = req.params;
      const result = await sessionsCollection.deleteOne({
        _id: new ObjectId(id),
        status: "pending",
      });
      res.send({ success: result.deletedCount > 0 });
    });

    // for booked sessions which use user

    // create booked session
    app.post("/booked-sessions", async (req, res) => {
      try {
        const bookedData = req.body;

        const result = await bookedSessionsCollection.insertOne(bookedData);
        res.send({ success: true, result });
      } catch (error) {
        console.error("Error booking session:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to book session" });
      }
    });

    // get users booked session via email
    app.get("/booked-sessions/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const query = { studentEmail: email };
        const result = await bookedSessionsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching user booked sessions:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // check the user booked in specific session
    app.get("/booked-sessions/check", async (req, res) => {
      try {
        const { email, sessionId } = req.query;

        if (!email || !sessionId) {
          return res
            .status(400)
            .json({ message: "Missing email or session ID" });
        }

        const alreadyBooked = await bookedSessionsCollection.findOne({
          sessionId,
          studentEmail: email,
        });

        res.send({ booked: !!alreadyBooked, ...alreadyBooked });
      } catch (error) {
        console.error("Booking check failed:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // if the user cancel booking then delete the data from this
    app.delete("/booked-sessions", async (req, res) => {
      try {
        const { email, sessionId } = req.query;

        if (!email || !sessionId) {
          return res
            .status(400)
            .json({ message: "Missing email or session ID" });
        }

        const result = await bookedSessionsCollection.deleteOne({
          sessionId,
          studentEmail: email,
          paymentStatus: { $ne: "paid" },
        });

        if (result.deletedCount > 0) {
          res.send({ success: true, message: "Booking canceled" });
        } else {
          res.send({
            success: false,
            message: "No unpaid booking found to cancel",
          });
        }
      } catch (error) {
        console.error("Error canceling booking:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ✅ POST /sessions/review/:id (Add review & update rating)

    app.post("/sessions/review/:id", async (req, res) => {
      const sessionId = req.params.id;
      const { studentName, reviewText, rating } = req.body;

      try {
        const session = await sessionsCollection.findOne({
          _id: new ObjectId(sessionId),
        });

        if (!session) {
          return res
            .status(404)
            .json({ success: false, message: "Session not found" });
        }

        // Append the new review
        const updatedReviews = [
          ...(session.reviews || []),
          { studentName, reviewText, rating },
        ];

        // Calculate new average rating
        const totalRating = updatedReviews.reduce(
          (sum, r) => sum + parseFloat(r.rating),
          0
        );
        const averageRating = parseFloat(
          (totalRating / updatedReviews.length).toFixed(1)
        );

        // Update in DB
        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(sessionId) },
          {
            $set: {
              reviews: updatedReviews,
              averageRating: averageRating,
            },
          }
        );

        res.json({
          success: true,
          message: "Review submitted",
          updated: result.modifiedCount > 0,
        });
      } catch (error) {
        console.error("Error submitting review:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    // for the notes

    // get users notes

    app.get("/notes/:email", async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) return res.status(400).send({ error: "Email is required" });

        const notes = await notesCollection.find({ email }).toArray();
        res.send(notes);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch notes" });
      }
    });

    // for update notes
    app.patch("/notes/:id", async (req, res) => {
      const { id } = req.params;
      const updatedNote = req.body;

      try {
        const result = await notesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedNote }
        );

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "Note updated successfully" });
        } else {
          res.send({
            success: false,
            message: "No changes made or note not found",
          });
        }
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Update failed", error });
      }
    });

    // for delete notes

    app.delete("/notes/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await notesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({ success: result.deletedCount > 0 });
      } catch (err) {
        res.status(500).send({ error: "Failed to delete note" });
      }
    });

    // create the students notes
    app.post("/notes", async (req, res) => {
      try {
        const { email, title, description } = req.body;
        if (!email || !title || !description) {
          return res
            .status(400)
            .send({ success: false, message: "All fields required" });
        }

        const result = await notesCollection.insertOne({
          email,
          title,
          description,
          createdAt: new Date().toISOString(),
        });

        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ success: false, message: "Server error" });
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
