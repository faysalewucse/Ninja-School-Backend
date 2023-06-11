const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { verifyJWT } = require("./middleware/verifyJWT");

require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPES_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Ninja School Server is running.");
});

app.post("/jwt", (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET_KEY, { expiresIn: "1h" });
  res.send({ token });
});

// Payment API
app.post("/create-payment-intent", verifyJWT, async (req, res) => {
  const { price } = req.body;
  const amount = parseInt(price) * 100;
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: "usd",
    payment_method_types: ["card"],
  });

  res.send({
    clientSecret: paymentIntent.client_secret,
  });
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = process.env.MONGODB_URL;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    client.connect();

    const database = client.db("ninjaSchoolDB");
    const users = database.collection("users");
    const classes = database.collection("classes");
    const bookedClasses = database.collection("bookedClasses");
    const payments = database.collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await users.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };

    // users
    app.get("/users/:userEmail", async (req, res) => {
      const email = req.params.userEmail;
      const result = await users.findOne({ email: email });
      res.send(result);
    });

    app.post("/user", async (req, res) => {
      const user = req.body;
      const result = await users.insertOne(user);
      res.send(result);
    });

    //****************classes************
    // get all approved classes
    app.post("/classes", async (req, res) => {
      const classData = req.body;
      const result = await classes.insertOne(classData);
      res.send(result);
    });

    app.get("/classes", async (req, res) => {
      const cursor = classes.find({ status: "approved" });
      const result = await cursor.toArray();

      res.send(result);
    });

    app.get("/allClasses", async (req, res) => {
      const cursor = classes.find().sort({ _id: -1 });
      const result = await cursor.toArray();

      res.send(result);
    });

    // get classes by instructor email
    app.get("/classes/:instructorEmail", verifyJWT, async (req, res) => {
      const cursor = classes.find({
        instructorEmail: req.params.instructorEmail,
      });
      const result = await cursor.toArray();

      res.send(result);
    });

    // get student booked classes
    app.get("/bookedClasses/:studentEmail", async (req, res) => {
      const cursor = bookedClasses.aggregate([
        {
          $match: { studentEmail: req.params.studentEmail },
        },
        {
          $lookup: {
            from: "classes",
            let: { classId: { $toObjectId: "$classId" } },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$classId"] },
                },
              },
            ],
            as: "classInfo",
          },
        },
      ]);

      const result = await cursor.toArray();

      res.send(result);
    });

    // delete student booked class
    app.delete("/bookedClasses/:bookedClassId", verifyJWT, async (req, res) => {
      const result = await bookedClasses.deleteOne({
        _id: new ObjectId(req.params.bookedClassId),
      });

      if (result.deletedCount === 1) {
        res.send(result);
      } else {
        res.send({ error: "Booked class not found." });
      }
    });

    // get popular classes
    app.get("/popularClasses", async (req, res) => {
      const result = await classes
        .aggregate([
          {
            $addFields: {
              enrolledStudents: {
                $subtract: ["$totalSeats", "$availableSeats"],
              },
            },
          },
          {
            $sort: { enrolledStudents: -1 },
          },
          {
            $limit: 6,
          },
        ])
        .toArray();

      res.send(result);
    });

    app.post("/bookedClass", async (req, res) => {
      const data = req.body;
      const result = await bookedClasses.insertOne(data);
      res.send(result);
    });

    app.put("/classes/:classId", verifyJWT, (req, res) => {
      const classId = req.params.classId;

      const result = classes.updateOne(
        { _id: new ObjectId(classId) },
        { $inc: { availableSeats: -1 } }
      );

      res.send(result);
    });

    app.patch(
      "/changeClassStatus/:classId",
      verifyJWT,
      verifyAdmin,
      (req, res) => {
        const classId = req.params.classId;
        const status = req.query.status;

        const result = classes.updateOne(
          { _id: new ObjectId(classId) },
          { $set: { status: status } }
        );

        res.send(result);
      }
    );

    app.patch("/feedback/:classId", verifyJWT, verifyAdmin, (req, res) => {
      const classId = req.params.classId;
      const message = req.query.message;

      const result = classes.updateOne(
        { _id: new ObjectId(classId) },
        { $set: { feedback: message } }
      );

      res.send(result);
    });

    // ************instructors**************
    // get all instructor
    app.get("/instructors", async (req, res) => {
      const cursor = users.aggregate([
        {
          $match: { role: "instructor" },
        },
        {
          $lookup: {
            from: "classes",
            localField: "email",
            foreignField: "instructorEmail",
            as: "classInfo",
          },
        },
      ]);

      const result = await cursor.toArray();

      res.send(result);
    });

    // get 6 popular instructor
    app.get("/instructors/popular", async (req, res) => {
      try {
        const popularInstructors = await users
          .aggregate([
            {
              $match: { role: "instructor" },
            },
            {
              $lookup: {
                from: "classes",
                localField: "email",
                foreignField: "instructorEmail",
                as: "classInfo",
              },
            },
            {
              $addFields: {
                totalStudents: {
                  $sum: {
                    $map: {
                      input: "$classInfo",
                      as: "class",
                      in: {
                        $subtract: [
                          "$$class.totalSeats",
                          "$$class.availableSeats",
                        ],
                      },
                    },
                  },
                },
              },
            },
            {
              $group: {
                _id: "$_id",
                name: { $first: "$name" },
                email: { $first: "$email" },
                photoURL: { $first: "$photoURL" },
                classInfo: { $push: "$classInfo" },
                totalStudents: { $sum: "$totalStudents" },
              },
            },
            {
              $sort: { totalStudents: -1 },
            },
            {
              $limit: 6,
            },
          ])
          .toArray();

        res.send(popularInstructors);
      } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Payments
    app.post("/payment", verifyJWT, async (req, res) => {
      const data = req.body;
      const result = await payments.insertOne(data);
      res.send(result);
    });

    app.get("/payments/:userEmail", verifyJWT, async (req, res) => {
      let sort = { _id: 1 };
      if (req.query.sort === "true") sort._id = -1;

      const cursor = payments.aggregate([
        {
          $match: { userEmail: req.params.userEmail },
        },
        {
          $lookup: {
            from: "classes",
            let: { classId: { $toObjectId: "$classId" } },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$classId"] },
                },
              },
            ],
            as: "classInfo",
          },
        },
        {
          $sort: sort,
        },
      ]);

      const result = await cursor.toArray();

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Ninja School Server listening on port ${port}`);
});
