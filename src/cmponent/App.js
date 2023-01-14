import React, { useEffect, useState } from 'react'

import Card from './Card'

function App() {
  const [State, setState] = useState([])

  useEffect(() => {
    fetch('https://dummyjson.com/products?limit=100')
      .then((result) => {
        let mydata = result.json()
        return mydata
      })
      .then((mydata) => {
        setState(mydata.products)
      })
  }, [])
  console.log(State)
  return (
    <div className='cardlist'>
      {State.map((ele) => {
        return <Card ele={ele} key={ele.id} />
      })}
    </div>
  )
}

export default App
