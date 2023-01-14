import React, { useState } from 'react'
import Viu from './Viu'
import '../App.css'

function Card({ ele }) {
  const [data, setdata] = useState(false)
  function mmm(e) {
    if (e.target.className === e.currentTarget.className) {
      console.log('cliked')
      setdata(false)
    }
  }

  return (
    <div
      className='card'
      onClick={() => {
        setdata(true)
      }}
    >
      {data && <Viu ele={ele} setdata={setdata} mmm={mmm} />}
      <img className='img' alt='no' src={ele.images[0]}></img>
      <p>{ele.title}</p>
    </div>
  )
}
export default Card
