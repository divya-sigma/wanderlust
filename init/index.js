const mongoose = require("mongoose");
const Listing = require("../models/listing.js");
const { sampleListings } = require("./data.js");

async function main() {
  await mongoose.connect("mongodb://127.0.0.1:27017/wanderlust");
  console.log("MongoDB connected!");
}
main().catch(err => console.log(err));

async function initDB() {
  await Listing.deleteMany({});       // clear old data
  await Listing.insertMany(sampleListings);
  console.log("Data initialized!");
}

initDB();