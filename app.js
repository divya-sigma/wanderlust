require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const methodOverride = require("method-override");
const session = require("express-session");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const multer = require("multer");
const { storage } = require("./cloudConfig.js");
const upload = multer({ storage });
const mbxGeocoding = require("@mapbox/mapbox-sdk/services/geocoding");

const Listing = require("./models/listing.js");
const Review = require("./models/review.js");
const User = require("./models/user.js");

const app = express();

const mapToken = process.env.MAPBOX_TOKEN;
const geocoder = mbxGeocoding({ accessToken: mapToken });

const dbUrl = process.env.ATLASDB_URL;
async function main() {
  await mongoose.connect(dbUrl);
  console.log("MongoDB connected!");
}
main().catch(err => console.log(err));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));

app.use(session({
  secret: "wanderlust-secret-key",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currUser = req.user;
  next();
});

// ── Listing Routes ──

app.get("/", (req, res) => res.redirect("/listings"));

app.get("/listings", async (req, res) => {
  const search = req.query.search || "";
  let allListings;

  if (search) {
    allListings = await Listing.find({
      $or: [
        { location: { $regex: search, $options: "i" } },
        { country: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
      ],
    });
  } else {
    allListings = await Listing.find({});
  }

  res.render("listings/index", { allListings, search });
});

app.get("/listings/new", (req, res) => {
  if (!req.isAuthenticated()) {
    req.flash("error", "You must be logged in to add a listing!");
    return res.redirect("/login");
  }
  res.render("listings/new");
});

app.get("/listings/:id", async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findById(id)
    .populate({ path: "reviews", populate: { path: "author" } })
    .populate("owner");
  res.render("listings/show", { listing });
});

app.post("/listings", upload.single("listing[image]"), async (req, res) => {
  if (!req.isAuthenticated()) {
    req.flash("error", "You must be logged in!");
    return res.redirect("/login");
  }
  const response = await geocoder.forwardGeocode({
    query: `${req.body.listing.location}, ${req.body.listing.country}`,
    limit: 1,
  }).send();

  const newListing = new Listing(req.body.listing);
  newListing.owner = req.user._id;
  newListing.geometry = response.body.features[0].geometry;
  if (req.file) {
    newListing.image = {
      url: req.file.path,
      filename: req.file.filename,
    };
  }
  await newListing.save();
  req.flash("success", "New listing created!");
  res.redirect("/listings");
});

app.get("/listings/:id/edit", async (req, res) => {
  if (!req.isAuthenticated()) {
    req.flash("error", "You must be logged in to edit!");
    return res.redirect("/login");
  }
  const { id } = req.params;
  const listing = await Listing.findById(id);
  res.render("listings/edit", { listing });
});

app.put("/listings/:id", upload.single("listing[image]"), async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findByIdAndUpdate(id, { ...req.body.listing });
  if (req.file) {
    listing.image = {
      url: req.file.path,
      filename: req.file.filename,
    };
    await listing.save();
  }
  req.flash("success", "Listing updated!");
  res.redirect(`/listings/${id}`);
});

app.delete("/listings/:id", async (req, res) => {
  const { id } = req.params;
  await Listing.findByIdAndDelete(id);
  req.flash("success", "Listing deleted!");
  res.redirect("/listings");
});

// ── Review Routes ──

app.post("/listings/:id/reviews", async (req, res) => {
  if (!req.isAuthenticated()) {
    req.flash("error", "You must be logged in to leave a review!");
    return res.redirect("/login");
  }
  const listing = await Listing.findById(req.params.id);
  const review = new Review(req.body.review);
  review.author = req.user._id;
  listing.reviews.push(review);
  await review.save();
  await listing.save();
  req.flash("success", "Review added!");
  res.redirect(`/listings/${req.params.id}`);
});

app.delete("/listings/:id/reviews/:reviewId", async (req, res) => {
  const { id, reviewId } = req.params;
  await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
  await Review.findByIdAndDelete(reviewId);
  req.flash("success", "Review deleted!");
  res.redirect(`/listings/${id}`);
});

// ── Auth Routes ──

app.get("/signup", (req, res) => res.render("auth/signup"));

app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const user = new User({ username, email });
    const registeredUser = await User.register(user, password);
    req.login(registeredUser, (err) => {
      if (err) return next(err);
      req.flash("success", "Welcome to Wanderlust!");
      res.redirect("/listings");
    });
  } catch (e) {
    req.flash("error", e.message);
    res.redirect("/signup");
  }
});

app.get("/login", (req, res) => res.render("auth/login"));

app.post("/login",
  passport.authenticate("local", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  (req, res) => {
    req.flash("success", "Welcome back!");
    res.redirect("/listings");
  }
);

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "Logged out successfully!");
    res.redirect("/listings");
  });
});

app.listen(3000, () => console.log("Server running on port 3000"));